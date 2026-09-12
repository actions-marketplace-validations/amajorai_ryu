use crate::state::SharedState;
use axum::{extract::State, response::IntoResponse};

pub async fn security_txt(State(state): State<SharedState>) -> impl IntoResponse {
    crate::security_contact::response(&state.config.public_contact)
}
