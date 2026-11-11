//! 让 cargo 知道前端产物变了要重编 —— include_dir! 本身不声明依赖。
fn main() {
    println!("cargo:rerun-if-changed=web/dist");
    println!("cargo:rerun-if-changed=web/dist/assets");
    println!("cargo:rerun-if-changed=web/dist/index.html");
}
