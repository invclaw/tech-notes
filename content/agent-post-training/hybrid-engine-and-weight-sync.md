> [!FOCUS] RL 集群最硬核的系统难题：怎么把训练引擎和推理引擎“焊”在一起？
> 普通预训练只需要 Megatron / FSDP，普通线上服务只需要 vLLM / SGLang；但 **RL 每走一步都要先用推理引擎高速采样几千条长轨迹，再用训练引擎算梯度更新权重，然后再把几十到几百 GB 的新权重秒级热刷回推理引擎**。怎么切显存不 OOM、怎么传权重不打爆网络、训推该共卡还是分离，是 RL 基础设施的核心分水岭。

![RL 训推混合集群：Colocated 同卡共置 vs Disaggregated 训推分离与权重热同步引擎对比](./assets/rl-hybrid-weight-sync.svg)

---

## 1. 2026 架构大迁移：从紧耦合 ShardingManager 到独立 CheckpointEngine

早期 RL 框架往往把训练引擎和推理引擎硬揉在同一个脚本里写死权重切分转换（比如早期 `verl` 的 `FSDPSGLangShardingManager`、`MegatronVLLMShardingManager`），每换一个训练后端或推理引擎就要重写整套胶水代码。

2026 年源码核验显示，这一层已彻底完成解耦演进：
- **`verl` (`9bdd3713`)**：已完全退役旧版 `RayPPOTrainer` 与 `sharding_manager/` 目录，拆成正交三层——**统一训练后端 `BaseEngine`**（屏蔽 FSDP2 / Megatron / VeOmni / TorchTitan 差异，统一吐出逐张量/分片/增量参数）+ **独立热同步层 `verl/checkpoint_engine/`** + **三模式调度器 `PPOTrainerSync` / `PPOTrainerColocateAsync` / `PPOTrainerSeparateAsync`**；
- **`slime` (`79aa41a8`)**：选择**垂直深耕 Megatron-LM + SGLang** 组合，把两者的并行拓扑转换（PP/EP 广播 → TP All-Gather → HF 权重格式转换）与 SGLang 内存占用接口（`release_memory_occupation` / `resume_memory_occupation`）打磨到极致。

---

## 2. Colocated 同卡共置 vs Disaggregated 训推分离

把训练和推理摆在 GPU 集群上，本质是**时分复用（同卡共置）**与**空间隔离（训推分离）**的架构取舍：

| 对比维度 | Colocated（同卡共置） | Disaggregated（训推分离） |
|---|---|---|
| **代表实现** | `verl` `PPOTrainerSync` / `PPOTrainerColocateAsync`；`slime --colocate` | `verl` `PPOTrainerSeparateAsync`（独立 Rollout 池）；`slime` 独立 `actor_pg` + `rollout_pg` |
| **GPU 资源利用** | 全部 GPU 先一起采样、再一起训练，**零配比失衡**；但存在显式 CPU offload/onload、休眠唤醒与 KV Cache 清空重建开销 | 采样池与训练池**流水线完全重叠**，消除等待慢样本的 GPU 气泡；但需调优训推卡比例（`verl` 引入 **`HybridEngineMode`**，训练池等样本空闲时动态切为 Rollout 副本） |
| **权重热同步方式** | 同节点 **CUDA IPC** 零网络带宽开销，耗时仅取决于参数聚合与本地显存搬运 | 跨节点走 **NCCL 分桶广播 / NIXL / Mooncake RDMA / 稀疏 Delta**；支持解耦 **Publish/Commit**（训练发完快照立刻继续算下一步，后台异步刷推理池） |
| **长周期沙箱与容错** | 同步共置每步必须中止并休眠推理引擎，不适合动辄跑几分钟的 Coding Agent 沙箱 | **天然适配长程 Agent**：训练侧崩溃重启或扩缩容时，推理池（含 SGLang/vLLM PD 分离实例）与在途沙箱轨迹全程不断 |
| **策略陈旧度** | 同步模式天然 **100% On-Policy（staleness = 0）** | 异步流水线必然引入 Off-Policy 陈旧度，必须配套陈旧度上界控制与 [TIS/OPSM/R3 校正](#/agent-post-training/rl-algorithms-and-stability) |

---

## 3. 共置模式防 OOM 铁律：两阶段显存唤醒时序

同卡共置最大的工程坑，是**训练侧权重还没退回 CPU，推理侧就同时把权重槽和几十 GB KV Cache 全唤醒回来，瞬间 OOM 炸机**。源码核验显示，`verl`（`ActorRolloutRefWorker.update_weights`）与 `slime`（`train.py`）不约而同收敛到完全一致的**两阶段唤醒协议**（这也直接解释了我们在 [vLLM V1 / TRT-LLM 源码](#/inference-engines/three-engines-architecture) 中看到的 `Sleep/WakeUp` 与 `/release_memory` 控制面接口的真正用途）：

```mermaid
sequenceDiagram
    participant Actor as 训练引擎 (FSDP2 / Megatron)
    participant GPU as 同卡 GPU 显存 (HBM)
    participant Rollout as 推理引擎 (SGLang / vLLM)

    Note over Actor,Rollout: 训练刚结束：Actor 占满显存，Rollout 处于 Sleep 休眠态
    Actor->>Rollout: 1. resume(tags=["weights"]) 仅唤醒推理权重显存槽
    Actor->>Rollout: 2. 流式逐桶 CUDA IPC 原地覆写新权重（支持在线 FP8/FP4 量化）
    Actor->>GPU: 3. actor.to("cpu") + empty_cache() + distributed.barrier()
    Note over GPU: 确保全部 rank 训练态彻底退场，腾出大块连续显存
    Actor->>Rollout: 4. resume(tags=["kv_cache"]) 唤醒 KV Cache 分页池
    Rollout->>Rollout: 5. 开启下一轮高并发 Rollout（结束时 release_memory_occupation 休眠）
```

> [!WARNING] 一个极其隐蔽的 CUDA IPC 并发 Bug（来自 `slime` 源码注释）
> 在同卡通过 `FlattenedTensorBucket` 给 SGLang 发 CUDA IPC 句柄时，`slime` **刻意每次都分配全新 Tensor 而不是复用发送缓冲区**——因为 SGLang 收到句柄后在自己的 CUDA Stream 上异步拷贝，如果发送端不等拷贝完成就复用原缓冲区写入下一桶参数，会悄无声息地把模型权重写花，导致训练指标莫名崩塌。

---

## 4. 四代权重热同步通道演进：从全量广播到稀疏字节差分

当模型规模迈向数百 B（如 671B MoE），且采用跨机训推分离时，每步全量传权重很快会撞上跨机网络墙。2026 年权重热同步已演进出四条技术路线：

1. **同卡 CUDA IPC（`verl` `naive` / `slime` `UpdateWeightFromTensor`）**：同机共置首选，零网络拷贝；
2. **双缓冲分桶 NCCL 广播（`verl` `NCCLCheckpointEngine` / `slime` `UpdateWeightFromDistributed`）**：
   - `verl` 采用 `send_buf`/`recv_buf` 双缓冲桶并支持 `multi_sender=True`（借同机 NVLink 邻卡作多 NIC 扇出中继）；
   - `slime` 为每个 Pipeline Parallel 阶段建独立 NCCL 组（`"slime-pp_{pp_rank}"`），把非专家 TP 参数与 MoE 专家 EP 参数分两段分桶广播，并支持 `compressed-tensors` INT4/FP4 前后置量化；
3. **RDMA 单边读 / P2P 引擎（`verl` `NIXL` / `Mooncake` / `KIMI PS`）**：直接复用推理引擎 [PD 分离架构](#/inference-engines/scheduling-and-acceleration) 里同一套 NIXL / Mooncake 高速 RDMA 通道，避免维护跨整个训练+推理集群的脆弱超大 NCCL 通信组；
4. **稀疏字节差分热同步（2026 最亮眼突破：`verl` `delta_sharded` & `slime` `UpdateWeightFromDiskDelta`）**：
   - 单步 RL 梯度更新后，大量 BF16/FP8 参数在数值量化粒度上实际**并未变化**。两家框架都在首轮全量同步后于 pinned CPU 建立权重快照，后续每步只比对字节差异，仅传输 `(int32 idx, val)` 稀疏补丁；
   - `verl` 通过 SGLang 官方 `--custom-weight-loader` 钩子原地 masked-apply，Rollout 端峰值额外显存仅 1 个 bucket；`slime` 更支持将压缩 Delta 写入共享存储，各机通过文件锁串行打补丁后重载，彻底摆脱跨集群通信组故障牵连。
