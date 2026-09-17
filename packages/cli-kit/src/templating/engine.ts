/**
 * FILE: engine.ts
 * PATH: packages/cli-kit/src/templating/engine.ts
 *
 * WHAT: Renders `{{token}}`-style placeholders in a template string against a token
 *       map.
 * WHY:  Plugin wizard `plan()` steps need to turn a static `.tmpl` source file (e.g. a
 *       slice template) into app-specific generated content (app name, chosen field
 *       names, etc.) — this is deliberately simple variable substitution, not a
 *       logic-heavy templating language, since all branching/conditional decisions
 *       belong in the wizard's TypeScript code, not hidden inside template syntax.
 * HOW:  A single regex replace; throws if a template references a token that wasn't
 *       provided, since a silently-empty substitution is a worse failure mode than a
 *       loud one at generation time.
 * WHEN: Called by every plugin's `plan()` step when turning `.tmpl` files into
 *       `filesToWrite` entries.
 *
 * EXPORTS: renderTemplate
 * DEPENDS ON: nothing
 * USED BY: every plugin's src/wizard/generate.ts (or equivalent)
 */

export function renderTemplate(source: string, tokens: Record<string, string>): string {
  return source.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in tokens)) {
      throw new Error(`Template references unknown token "{{${key}}}".`);
    }
    return tokens[key] as string;
  });
}
