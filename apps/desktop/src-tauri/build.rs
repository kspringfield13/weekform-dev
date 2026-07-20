fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/calendar_eventkit.m");
        println!("cargo:rerun-if-changed=src/macos_app_activation.m");
        cc::Build::new()
            .file("src/calendar_eventkit.m")
            .file("src/macos_app_activation.m")
            .flag("-fobjc-arc")
            .compile("weekform_eventkit");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=EventKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    tauri_build::build()
}
