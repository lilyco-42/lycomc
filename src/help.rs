//! H39：离线内嵌帮助、关于、许可边界、反馈与文档索引。
//!
//! 只保存本项目独立编写的中文主题与公开链接；不联网、不读取 PCL-CE 源码，
//! 不复制自定义 LICENCE 目录里的规则、正则、文案、图标或资产。

use serde_json::{json, Value};

const DATA: &str = include_str!("help_data.json");
const MAX_QUERY_CHARS: usize = 128;

fn data() -> Value {
    serde_json::from_str(DATA).expect("embedded help data must be valid JSON")
}

fn field<'a>(topic: &'a Value, key: &str) -> &'a str {
    topic.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// 全部内联帮助主题；顺序由嵌入的 JSON 数组决定，稳定且与 HashMap 无关。
pub fn topics() -> Vec<Value> {
    data()
        .get("topics")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// 关于页数据。版本号与内嵌前端状态来自编译期/运行时，不返回任何账号凭据。
pub fn about() -> Value {
    let mut root = data();
    let topics = topics();
    let web_mode = if crate::assets::embedded() {
        "embedded"
    } else {
        "missing"
    };
    if let Some(object) = root.as_object_mut() {
        object.remove("topics");
        object.insert("version".to_string(), json!(env!("CARGO_PKG_VERSION")));
        object.insert("webMode".to_string(), json!(web_mode));
        object.insert("helpTopics".to_string(), json!(topics));
        object.insert("helpSearchPath".to_string(), json!("/api/help/search?q="));
    }
    root
}

/// 离线 AND 搜索：空关键词返回全部主题；过长关键词返回 None，由 API 映射 400。
/// 响应只含匹配的主题，不回显原始查询字符串，避免把不可信输入再次渲染。
pub fn search(q: &str) -> Option<Value> {
    let trimmed = q.trim();
    if trimmed.chars().count() > MAX_QUERY_CHARS {
        return None;
    }
    let words: Vec<String> = trimmed
        .split_whitespace()
        .map(|word| word.to_lowercase())
        .collect();
    let items: Vec<Value> = topics()
        .into_iter()
        .filter(|topic| {
            if words.is_empty() {
                return true;
            }
            let haystack = format!(
                "{} {} {} {}",
                field(topic, "id"),
                field(topic, "title"),
                field(topic, "category"),
                field(topic, "summary")
            )
            .to_lowercase();
            words.iter().all(|word| haystack.contains(word))
        })
        .collect();
    Some(json!({"items": items, "count": items.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn about_is_offline_stable_and_does_not_claim_a_license() {
        let a = about();
        assert_eq!(a["name"], "LilyCraft Web");
        assert_eq!(a["product"], "lycomc");
        assert_eq!(a["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(a["licenseStatus"], "unspecified");
        assert_eq!(a["upstream"]["version"], "v2.15.1");
        assert!(a["issues"].as_str().unwrap().starts_with("https://"));
        assert!(a.as_object().unwrap().contains_key("helpTopics"));
        assert!(a["helpTopics"].as_array().unwrap().len() >= 12);
        assert!(a.get("accessToken").is_none());
        assert!(a.get("refreshToken").is_none());
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&about()).unwrap()
        );
    }

    #[test]
    fn empty_search_returns_all_topics_in_stable_order() {
        let all = topics();
        let empty = search("").unwrap();
        let blank = search("   ").unwrap();
        assert_eq!(empty["count"], all.len());
        assert_eq!(empty["items"], json!(all));
        assert_eq!(
            serde_json::to_string(&empty).unwrap(),
            serde_json::to_string(&blank).unwrap()
        );
    }

    #[test]
    fn search_matches_chinese_and_ascii_case_insensitively() {
        let mods = search("MOD").unwrap();
        assert!(mods["count"].as_u64().unwrap() >= 2);
        let backups = search("备份").unwrap();
        assert!(backups["count"].as_u64().unwrap() >= 2);
        let quick = search("quickplay").unwrap();
        assert_eq!(quick["items"][0]["id"], "quickplay");
    }

    #[test]
    fn unknown_query_is_empty_and_overlong_query_is_rejected() {
        let no_match = search("不存在的关键词xyz").unwrap();
        assert_eq!(no_match["count"], 0);
        assert!(no_match.get("query").is_none());
        assert!(search(&"x".repeat(MAX_QUERY_CHARS + 1)).is_none());
        assert_eq!(search(&"x".repeat(MAX_QUERY_CHARS)).unwrap()["count"], 0);
    }
}
