fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/calendar_eventkit.m");
        cc::Build::new()
            .file("src/calendar_eventkit.m")
            .flag("-fobjc-arc")
            .compile("weekform_eventkit");
        println!("cargo:rustc-link-lib=framework=EventKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    tauri_build::build()
}
