var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// core.cjs
var require_core = __commonJS({
  "core.cjs"(exports, module) {
    var RULES = Object.freeze([
      { id: "high-risk", pattern: /\b(security|vulnerab|architect|migration|race condition)\w*/i, model: "opus", effort: "high" },
      { id: "trivial", pattern: /\b(typo|rename|comment|format|lint|css)\w*/i, model: "haiku", effort: "low" }
    ]);
    var MANUAL_MODELS = Object.freeze(["haiku", "sonnet", "opus"]);
    function decide(text, options) {
      const override = options && options.override;
      if (override && MANUAL_MODELS.includes(override)) {
        return { model: override, effort: void 0, source: "manual", reason: `manual override: ${override}` };
      }
      const input = typeof text === "string" ? text : "";
      const rule = RULES.find((r) => r.pattern.test(input));
      if (rule) {
        return { model: rule.model, effort: rule.effort, source: "rule", reason: `rule ${rule.id}` };
      }
      return { model: "sonnet", effort: "medium", source: "default", reason: "no rule matched" };
    }
    module.exports = { decide, MANUAL_MODELS };
  }
});
export default require_core();
