//! 前端产物（web/dist）打包进二进制。
//!
//! Vite 出来的 dist 在编译期被 include_dir 读进只读静态段，运行时不需要
//! 磁盘上存在 web/dist —— 单文件分发即可打开 Web 控制台。
//! 开发前端时仍可 pnpm dev，那时后端只负责 API。
//!
//! include_dir 的宏只接受字面量路径或 $VAR，这里用 $CARGO_MANIFEST_DIR。

use include_dir::{include_dir, Dir, File};

static DIST: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/web/dist");

/// 相对 dist 根取文件；拒绝任何 .. 穿越。
///
/// 找不到且路径「看起来像前端路由」（没有扩展名）时回落到 index.html，
/// 让 SPA 客户端路由刷新也能命中。
pub fn get(path: &str) -> Option<&'static File<'static>> {
    let clean = path.trim_start_matches('/');
    if clean.is_empty() {
        return DIST.get_file("index.html");
    }
    if clean.split('/').any(|c| c == ".." || c.is_empty()) {
        return None;
    }
    if let Some(f) = DIST.get_file(clean) {
        return Some(f);
    }
    if std::path::Path::new(clean).extension().is_none() {
        return DIST.get_file("index.html");
    }
    None
}

pub fn index_html() -> Option<&'static [u8]> {
    DIST.get_file("index.html").map(|f| f.contents())
}

pub fn embedded() -> bool {
    index_html().is_some()
}
