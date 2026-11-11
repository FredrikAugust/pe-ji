fn main() {
    // `generate_context!` requires the frontend dist path to exist at compile time.
    // A placeholder is enough for `cargo test`; `pnpm build` replaces it.
    let dist = std::path::Path::new("../dist");
    if !dist.join("index.html").exists() {
        std::fs::create_dir_all(dist).expect("create dist");
        std::fs::write(dist.join("index.html"), "<!doctype html><title>ぴこぴこ作文帳</title>\n")
            .expect("write dist placeholder");
    }
    tauri_build::build()
}
