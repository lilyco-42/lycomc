//! 让 cargo 知道前端产物变了要重编 —— include_dir! 本身不声明依赖。
fn main() {
    println!("cargo:rerun-if-changed=web/dist");
    println!("cargo:rerun-if-changed=web/dist/assets");
    println!("cargo:rerun-if-changed=web/dist/index.html");
    println!("cargo:rerun-if-changed=web/public/steve.png");
    println!("cargo:rerun-if-changed=web/public/alex.png");
    println!("cargo:rerun-if-changed=web/public/favicon.svg");
    println!("cargo:rerun-if-changed=web/public/manifest.webmanifest");
    println!("cargo:rerun-if-changed=packaging/icons/icon.svg");
}
