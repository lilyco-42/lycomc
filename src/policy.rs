//! 安全策略：命令分级 -> 放行/拒绝。
//!
//! lycomc 的写操作只落在两处：用户自己的数据目录（~/.local/share/lycomc）
//! 与 Minecraft 实例目录。不碰系统面，所以本地交互面放行 T0/T1。
//!
//! MCP（Agent 无人值守）另用 Agent 策略：只读全放行，写操作只允许
//! 白名单里那几个「装/删/启动」的命令 —— 换设置、改 java 路径这类
//! 影响后续所有启动的决定必须由人类做。

use lilyco::prelude::{GateDecision, GateRequest, SafetyPolicy, SafetyTier};

/// 本地交互面：T0 / T1 放行
pub struct LocalOnly;

impl SafetyPolicy for LocalOnly {
    fn check(&self, req: GateRequest<'_>) -> GateDecision {
        match req.tier {
            SafetyTier::ReadOnly | SafetyTier::Confirm => GateDecision::Allow,
            other => GateDecision::Deny(format!(
                "命令 {} 分级为 {}：lycomc 只放行只读与本地写（T0/T1）",
                req.command,
                other.tag()
            )),
        }
    }
}

/// Agent 面：只读全放行，写操作仅白名单
pub struct Agent;

const AGENT_ALLOWED: &[&str] = &["install", "launch", "mod-add", "mod-remove", "list", "info"];

impl SafetyPolicy for Agent {
    fn check(&self, req: GateRequest<'_>) -> GateDecision {
        match req.tier {
            SafetyTier::ReadOnly => GateDecision::Allow,
            SafetyTier::Confirm if AGENT_ALLOWED.contains(&req.command) => GateDecision::Allow,
            other => GateDecision::Deny(format!(
                "命令 {} 分级为 {}：Agent 调用面不放行（人类可用 lycomc --web 或 CLI 手动执行）",
                req.command,
                other.tag()
            )),
        }
    }
}
