mod ai;

use ai::AiRuntime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ai_runtime = AiRuntime::new().expect("failed to initialize the scoped AI HTTP client");

    tauri::Builder::default()
        .manage(ai_runtime)
        .invoke_handler(tauri::generate_handler![
            ai::save_ai_credential,
            ai::has_ai_credential,
            ai::delete_ai_credential,
            ai::clear_all_ai_credentials,
            ai::test_ai_provider_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AXIS");
}
