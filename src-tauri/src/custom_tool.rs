//! Custom tool support (Phase 5c).
//!
//! The JS `customToolsStore` lets the user define their own
//! AI-callable tools in a workspace-local `lipi-tools.json` file.
//! Each tool is either a **shell command** (template with `{arg}`
//! placeholders) or an **HTTP request** (URL template with `{arg}`
//! placeholders, optional method/headers/body).
//!
//! The Rust side doesn't need to know how to EXECUTE a custom tool
//! (the JS `toolRegistry` has the shell and http handlers). It does
//! need to know how to DECLARE one to the provider — i.e. produce
//! the right JSON Schema for the model's `tools: [...]` array.
//!
//! This module owns:
//!   - The wire shape (`CustomToolSpec`, `CustomToolArg`).
//!   - The provider-specific JSON conversion
//!     (`custom_tool_to_openai`, `custom_tool_to_anthropic`).
//!   - A `merge_tool_list` helper that combines the built-in
//!     `TOOL_CATALOGUE` (in `chat.rs`) with the per-request
//!     custom tool list, filtered by the enabled whitelist.
//!   - Round-trip JSON tests for the wire shape.
//!
//! The TS side mirrors the same shape
//! (`src/ipc/ai.ts::CustomToolSpec` and friends). The two
//! sides are kept in sync by hand for the MVP — the JS
//! `customToolsStore` is the source of truth for the
//! runtime; the Rust side is the wire-level passthrough.
//!
//! ## Argument types
//!
//! Custom tool args are a tiny type system — just `'string'`
//! for 5c. We could add `'number'`, `'boolean'`, `'enum'`
//! later, but the MVP covers the use cases (commands take
//! paths/identifiers; HTTP fetches take IDs/queries). Each
//! arg is required by default; the future `required: false`
//! field is a 5d+ addition.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// A single tool argument (5c MVP). The model receives the
/// generated JSON Schema for the tool's `parameters` /
/// `input_schema`; this struct is the per-arg piece.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomToolArg {
    /// Argument name (e.g. `"path"`). Must match a
    /// `{name}` placeholder in the tool's command/url
    /// template. Case-sensitive. Must be a valid
    /// identifier (alphanumeric + underscore; we don't
    /// enforce this on the Rust side — the JS side
    /// validates in the editor).
    pub name: String,
    /// Argument type. Only `"string"` in 5c. Future
    /// `"number" | "boolean" | "enum"` are 5d+ additions.
    #[serde(rename = "type")]
    pub type_: String,
    /// Human-readable description shown to the model in
    /// the tool's JSON Schema. The JS `customToolsStore`
    /// makes this required; the Rust side accepts an
    /// empty string.
    #[serde(default)]
    pub description: String,
}

/// The wire shape of a custom tool as it crosses the
/// JS↔Rust boundary. The Rust side doesn't see the
/// tool's `command`/`url`/etc. (only the JS executor
/// needs those) — it only needs enough to build the
/// provider-specific tool declaration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomToolSpec {
    /// Tool name (e.g. `"run_npm_test"`). Must be unique
    /// across the registry. The JS `customToolsStore`
    /// enforces this on save; the Rust side is defensive
    /// (if two customs collide, the last one wins — this
    /// is a JS-side bug to fix, not a Rust-side concern).
    pub name: String,
    /// Human-readable description shown to the model in
    /// the tool's JSON Schema.
    pub description: String,
    /// Ordered list of arguments. The order is preserved
    /// in the generated JSON Schema (matters for the
    /// Anthropic tool spec where the model uses the
    /// ordering for argument name extraction; OpenAI
    /// doesn't care).
    pub args: Vec<CustomToolArg>,
}

/// 5c: convert a `CustomToolSpec` to the OpenAI tool
/// declaration shape:
/// `{type:"function", function:{name, description, parameters:<JSON Schema>}}`.
///
/// The generated `parameters` schema is the JSON Schema
/// object `{type:"object", properties: {<arg.name>: {...}},
/// required: [<arg.name>], additionalProperties: false}`.
/// We only support string args in 5c; the schema is
/// straightforward.
pub fn custom_tool_to_openai(spec: &CustomToolSpec) -> Value {
    let mut properties = serde_json::Map::new();
    let mut required: Vec<String> = Vec::with_capacity(spec.args.len());
    for arg in &spec.args {
        let mut arg_schema = serde_json::Map::new();
        arg_schema.insert("type".to_string(), Value::String(arg.type_.clone()));
        if !arg.description.is_empty() {
            arg_schema.insert(
                "description".to_string(),
                Value::String(arg.description.clone()),
            );
        }
        properties.insert(arg.name.clone(), Value::Object(arg_schema));
        // All 5c args are required. A 5d+ `required: false`
        // field would skip them here.
        required.push(arg.name.clone());
    }
    let parameters = json!({
        "type": "object",
        "properties": Value::Object(properties),
        "required": Value::Array(required.into_iter().map(Value::String).collect()),
        "additionalProperties": false,
    });
    json!({
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": parameters,
        }
    })
}

/// 5c: convert a `CustomToolSpec` to the Anthropic tool
/// declaration shape:
/// `{name, description, input_schema:<JSON Schema>}`.
///
/// The `input_schema` is the same JSON Schema as the
/// OpenAI `parameters` (no wrapper, no `type:"function"`).
pub fn custom_tool_to_anthropic(spec: &CustomToolSpec) -> Value {
    let openai = custom_tool_to_openai(spec);
    // The function-level shape for OpenAI is
    // `{type:"function", function:{...}}`. For Anthropic
    // we want `{name, description, input_schema}` — so
    // unwrap one layer and rename `parameters` →
    // `input_schema`.
    let function = openai.get("function").cloned().unwrap_or(Value::Null);
    let mut obj = function.as_object().cloned().unwrap_or_default();
    if let Some(params) = obj.remove("parameters") {
        obj.insert("input_schema".to_string(), params);
    }
    Value::Object(obj)
}

/// 5c: merge the built-in `TOOL_CATALOGUE` (from
/// `chat.rs::tool_catalogue`) with the per-request
/// custom tool list, filtered by the enabled
/// whitelist, and shaped for the named provider.
///
/// `build_builtins` is a closure (not a direct call)
/// because the test in `chat.rs` needs to mock it —
/// and the test lives in the same module, so a
/// closure keeps the API minimal.
///
/// We filter FIRST, then convert. The "empty
/// enabled list = all enabled" legacy default from
/// 5b-7 is honored by the closure (the caller passes
/// the same `is_tool_enabled` predicate it already
/// uses for the built-ins).
pub fn merge_tool_list<F>(
    build_builtins: F,
    custom_tools: &[CustomToolSpec],
    enabled: &[String],
) -> Vec<Value>
where
    F: FnOnce(&[String]) -> Vec<Value>,
{
    let mut out = build_builtins(enabled);
    for spec in custom_tools {
        if !is_enabled(enabled, &spec.name) {
            continue;
        }
        out.push(custom_tool_to_openai(spec));
    }
    out
}

/// 5c: same as `merge_tool_list` but for Anthropic —
/// uses the Anthropic shape. Kept as a separate
/// function so the two adapters can call them
/// without crossing provider semantics.
pub fn merge_tool_list_anthropic<F>(
    build_builtins: F,
    custom_tools: &[CustomToolSpec],
    enabled: &[String],
) -> Vec<Value>
where
    F: FnOnce(&[String]) -> Vec<Value>,
{
    let mut out = build_builtins(enabled);
    for spec in custom_tools {
        if !is_enabled(enabled, &spec.name) {
            continue;
        }
        out.push(custom_tool_to_anthropic(spec));
    }
    out
}

/// Same `is_tool_enabled` predicate as `chat.rs` —
/// copied here to avoid a cross-module dependency.
/// The two implementations MUST stay in sync. If
/// 5b-7's semantics ever change, update both.
fn is_enabled(enabled: &[String], name: &str) -> bool {
    if enabled.is_empty() {
        // Legacy "all enabled" default.
        return true;
    }
    enabled.iter().any(|n| n == name)
}

// --- Tests ------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_spec() -> CustomToolSpec {
        CustomToolSpec {
            name: "run_npm_test".to_string(),
            description: "Run npm test in a specific package directory.".to_string(),
            args: vec![CustomToolArg {
                name: "package_dir".to_string(),
                type_: "string".to_string(),
                description: "Path to the package, e.g. 'packages/core'.".to_string(),
            }],
        }
    }

    #[test]
    fn custom_tool_spec_round_trips_as_camel_case_json() {
        // Wire invariant: the JSON the JS side sends
        // matches what the Rust side deserialises.
        // The JS code uses camelCase (`type` would be
        // reserved, so the field is `type_` on the
        // Rust side with a `#[serde(rename = "type")]`
        // — this is the one quirk).
        let json_str = r#"{
            "name": "fetch_jira_issue",
            "description": "Fetch a Jira issue by key.",
            "args": [
                { "name": "key", "type": "string", "description": "Jira key, e.g. PROJ-123." }
            ]
        }"#;
        let spec: CustomToolSpec = serde_json::from_str(json_str).unwrap();
        assert_eq!(spec.name, "fetch_jira_issue");
        assert_eq!(spec.args.len(), 1);
        assert_eq!(spec.args[0].type_, "string");

        // Re-serialise — the field name `type_` is
        // renamed back to `type` on the way out.
        let out = serde_json::to_value(&spec).unwrap();
        assert_eq!(out["args"][0]["type"], "string");
        assert_eq!(out["args"][0]["name"], "key");
    }

    #[test]
    fn custom_tool_to_openai_produces_expected_shape() {
        let spec = sample_spec();
        let out = custom_tool_to_openai(&spec);
        assert_eq!(out["type"], "function");
        assert_eq!(out["function"]["name"], "run_npm_test");
        assert_eq!(
            out["function"]["description"],
            "Run npm test in a specific package directory."
        );
        let params = &out["function"]["parameters"];
        assert_eq!(params["type"], "object");
        assert_eq!(params["properties"]["package_dir"]["type"], "string");
        assert_eq!(
            params["properties"]["package_dir"]["description"],
            "Path to the package, e.g. 'packages/core'."
        );
        let required = params["required"].as_array().unwrap();
        assert_eq!(required, &vec![json!("package_dir")]);
        assert_eq!(params["additionalProperties"], false);
    }

    #[test]
    fn custom_tool_to_anthropic_uses_input_schema_not_parameters() {
        let spec = sample_spec();
        let out = custom_tool_to_anthropic(&spec);
        // No `type:"function"` wrapper.
        assert!(out.get("type").is_none());
        assert_eq!(out["name"], "run_npm_test");
        // `input_schema` is present, `parameters` is not.
        assert!(out.get("input_schema").is_some());
        assert!(out.get("function").is_none());
        assert!(out.get("parameters").is_none());
    }

    #[test]
    fn empty_args_produces_empty_required_array_and_empty_properties() {
        let spec = CustomToolSpec {
            name: "noop".to_string(),
            description: "Does nothing.".to_string(),
            args: vec![],
        };
        let out = custom_tool_to_openai(&spec);
        let params = &out["function"]["parameters"];
        assert_eq!(params["type"], "object");
        assert_eq!(params["properties"], json!({}));
        assert_eq!(params["required"], json!([]));
        assert_eq!(params["additionalProperties"], false);
    }

    #[test]
    fn merge_tool_list_includes_builtins_and_customs_filtered_by_enabled() {
        // Stub built-ins: two tools, both enabled.
        let build_builtins = |_enabled: &[String]| -> Vec<Value> {
            vec![
                json!({"type": "function", "function": {"name": "get_file_contents"}}),
                json!({"type": "function", "function": {"name": "read_terminal"}}),
            ]
        };
        let customs = vec![
            CustomToolSpec {
                name: "run_npm_test".to_string(),
                description: "Run npm test.".to_string(),
                args: vec![],
            },
            CustomToolSpec {
                name: "fetch_jira".to_string(),
                description: "Fetch a Jira issue.".to_string(),
                args: vec![],
            },
        ];
        // Whitelist: only get_file_contents and run_npm_test.
        let enabled = vec!["get_file_contents".to_string(), "run_npm_test".to_string()];
        let merged = merge_tool_list(build_builtins, &customs, &enabled);
        // The OpenAI shape nests the name under
        // `function.name`. We check that.
        let names: Vec<String> = merged
            .iter()
            .map(|v| {
                v.get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string()
            })
            .collect();
        assert_eq!(
            names,
            vec!["get_file_contents", "read_terminal", "run_npm_test"]
        );
    }

    #[test]
    fn merge_tool_list_with_empty_enabled_means_all_enabled() {
        // Legacy 5b-7 default: empty enabled list = all.
        let build_builtins = |_enabled: &[String]| -> Vec<Value> {
            vec![json!({"function": {"name": "get_file_contents"}})]
        };
        let customs = vec![CustomToolSpec {
            name: "run_npm_test".to_string(),
            description: "Run npm test.".to_string(),
            args: vec![],
        }];
        let merged = merge_tool_list(build_builtins, &customs, &[]);
        let names: Vec<String> = merged
            .iter()
            .map(|v| {
                v.get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string()
            })
            .collect();
        assert_eq!(names, vec!["get_file_contents", "run_npm_test"]);
    }

    #[test]
    fn merge_tool_list_anthropic_shape_is_used() {
        // Sanity: the anthropic mergeer produces
        // Anthropic-shaped declarations, not OpenAI
        // (no `type:"function"`, has `input_schema`).
        let build_builtins = |_enabled: &[String]| -> Vec<Value> {
            vec![json!({"name": "get_file_contents", "input_schema": {}})]
        };
        let customs = vec![CustomToolSpec {
            name: "run_npm_test".to_string(),
            description: "Run npm test.".to_string(),
            args: vec![CustomToolArg {
                name: "package_dir".to_string(),
                type_: "string".to_string(),
                description: String::new(),
            }],
        }];
        let merged = merge_tool_list_anthropic(build_builtins, &customs, &[]);
        // The first entry is the built-in (Anthropic
        // shape), the second is the custom tool.
        let run_npm = &merged[1];
        assert!(run_npm.get("type").is_none());
        assert!(run_npm.get("function").is_none());
        assert_eq!(run_npm["name"], "run_npm_test");
        assert!(run_npm.get("input_schema").is_some());
    }
}
