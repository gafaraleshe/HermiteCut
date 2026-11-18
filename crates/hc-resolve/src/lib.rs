//! HermiteCut's DaVinci Resolve adapter.
//!
//! [`bridge`] runs `hosts/resolve/bridge.lua` inside fuscript and speaks its
//! JSON-lines protocol. [`Resolve`] builds the app's actions on top of it.
//! The Rust port of `hosts/resolve` (standalone mode).

mod actions;
pub mod bridge;

pub use actions::Resolve;
pub use bridge::{Bridge, Error};
