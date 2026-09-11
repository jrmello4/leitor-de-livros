use tauri::{plugin::TauriPlugin, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("mobile-import")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(
                "com.jrmello4.tactilereader.mobileimport",
                "MobileImportPlugin",
            )?;
            Ok(())
        })
        .build()
}
