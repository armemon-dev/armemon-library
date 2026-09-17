/**
 * FILE: htmlPatcher.ts
 * PATH: packages/cli-kit/src/fs/htmlPatcher.ts
 *
 * WHAT: Injects plugin-contributed markup into the web target's index.html.
 * WHY:  Some things have to be in the HTML itself, before the bundle parses, or they
 *       do nothing. A splash screen is the clearest case: on native the OS draws it
 *       from generated assets before any JavaScript exists, and the only web
 *       equivalent is markup the browser paints on first frame. Anything rendered by
 *       React is by definition too late — it appears after the bundle has loaded and
 *       run, which is exactly the gap a splash exists to cover.
 * HOW:  String insertion before </head> and after <body>, applied to the plan's
 *       index.html content before it is written, so it composes with whatever the
 *       web scaffold emitted rather than fighting it over the same file.
 * WHEN: Called once by the init flow when the web platform is targeted and any
 *       plugin contributed HTML.
 *
 *
 *       addHtmlContributions and removeHtmlContributions do the same for an index.html
 *       that already exists, for `armemon plugin add/remove`. A block comes out only
 *       when it is still exactly what went in: a splash someone restyled is theirs.
 *
 * EXPORTS: applyHtmlContributions, addHtmlContributions, removeHtmlContributions, HtmlContribution
 * DEPENDS ON: @armemon-library/config-types, ./patchResult
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts,
 *          packages/cli-armemon/src/flows/plugins/reconcile.ts
 */

import type { PluginInstallPlan } from '@armemon-library/config-types';
import { done, refused, type PatchResult } from './patchResult.js';

type HtmlContributions = NonNullable<PluginInstallPlan['htmlContributions']>;

/**
 * Re-indents one contribution to sit at `spaces` inside the document.
 *
 * A contribution is often a multi-line <style> block whose own indentation comes
 * from the template literal it was written in. Prefixing only the first line left
 * the rest at whatever depth the plugin author's source happened to use, so the
 * first file a web developer opens had a visibly crooked <style> block. The
 * entry's INTERNAL relative indentation is preserved; only its base moves.
 */
function indent(entry: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  const lines = entry.split('\n');
  const rest = lines.slice(1).filter((line) => line.trim().length > 0);
  const base = rest.length > 0 ? Math.min(...rest.map((line) => line.length - line.trimStart().length)) : 0;

  return lines
    .map((line, index) => {
      if (index === 0) return `${pad}${line.trimStart()}`;
      if (line.trim().length === 0) return '';
      return `${pad}${line.slice(base)}`;
    })
    .join('\n');
}

/** One plugin's markup, and whose it is — which is what lets it be taken out again. */
export type HtmlContribution = HtmlContributions & { pluginId?: string };

/**
 * One section of one plugin's markup as it appears in the page. With a plugin id it
 * sits between `<!-- armemon:<id> -->` markers, which say where it came from to
 * whoever opens the file and let `armemon plugin remove` find it exactly.
 */
function sectionBlock(entries: string[], pluginId?: string): string {
  const inner = entries.map((entry) => indent(entry, 4)).join('\n');
  return pluginId ? `    <!-- armemon:${pluginId} -->\n${inner}\n    <!-- /armemon:${pluginId} -->` : inner;
}

export function applyHtmlContributions(html: string, contributions: HtmlContribution[]): string {
  const head = contributions
    .filter((entry) => (entry.head ?? []).length > 0)
    .map((entry) => sectionBlock(entry.head!, entry.pluginId));
  const bodyStart = contributions
    .filter((entry) => (entry.bodyStart ?? []).length > 0)
    .map((entry) => sectionBlock(entry.bodyStart!, entry.pluginId));

  let output = html;

  if (head.length > 0) {
    const block = head.join('\n');
    // Match the closing tag WITH its own leading whitespace. Replacing the bare
    // '</head>' inserts the block after that indentation, which added the closing
    // tag's two spaces to the block's first line and left it hanging.
    // A function, not a replacement string: in a string, `$&` and friends are
    // patterns, and a contribution's CSS or script is free to contain them.
    const closing = output.match(/^[ \t]*<\/head>/m);
    output = closing
      ? output.replace(closing[0], () => `${block}\n${closing[0]}`)
      : `${block}\n${output}`;
  }

  if (bodyStart.length > 0) {
    const block = bodyStart.join('\n');
    const bodyOpen = output.match(/<body[^>]*>/);
    output = bodyOpen
      ? output.replace(bodyOpen[0], () => `${bodyOpen[0]}\n${block}`)
      : `${block}\n${output}`;
  }

  return output;
}

/** Each section a contribution puts into the page: its entries and where they go. */
function sectionsOf(contribution: HtmlContribution): Array<{ entries: string[]; where: 'head' | 'bodyStart' }> {
  return (['head', 'bodyStart'] as const)
    .filter((where) => (contribution[where] ?? []).length > 0)
    .map((where) => ({ entries: contribution[where]!, where }));
}

const withEol = (text: string, eol: string) => (eol === '\n' ? text : text.replace(/\n/g, eol));
const markerOf = (pluginId: string) => `<!-- armemon:${pluginId} -->`;

/** The part of the page a section lives in: before </head>, or from <body> on. */
function regionOf(html: string, where: 'head' | 'bodyStart'): string {
  const close = html.search(/<\/head>/);
  if (close === -1) return html;
  return where === 'head' ? html.slice(0, close) : html.slice(close);
}

/** Adds the contributions not already in the page. */
export function addHtmlContributions(html: string, contributions: HtmlContribution[]): PatchResult {
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const normalized = eol === '\n' ? html : html.replace(/\r\n/g, '\n');

  const missing: HtmlContribution[] = contributions
    .map((contribution) => {
      const sections = sectionsOf(contribution).filter(({ entries, where }) => {
        if (normalized.includes(sectionBlock(entries, contribution.pluginId))) return false;
        // Its markers are already there, around something edited: that is theirs now.
        if (contribution.pluginId && regionOf(normalized, where).includes(markerOf(contribution.pluginId))) return false;
        return !normalized.includes(sectionBlock(entries));
      });
      return {
        pluginId: contribution.pluginId,
        head: sections.find((section) => section.where === 'head')?.entries,
        bodyStart: sections.find((section) => section.where === 'bodyStart')?.entries,
      };
    })
    .filter((entry) => entry.head || entry.bodyStart);
  if (missing.length === 0) return done(html, 'web/index.html already has this markup');

  const manual = `Add this to web/index.html — the head part before </head>, the rest straight after <body>:\n${missing
    .flatMap((entry) => sectionsOf(entry).map(({ entries }) => sectionBlock(entries, entry.pluginId)))
    .join('\n')}`;
  if (missing.some((entry) => entry.head) && !/^[ \t]*<\/head>/m.test(normalized)) {
    return refused(html, 'web/index.html has no </head> on a line of its own', manual);
  }
  if (missing.some((entry) => entry.bodyStart) && !/<body[^>]*>/.test(normalized)) {
    return refused(html, 'web/index.html has no <body> tag', manual);
  }

  return { content: withEol(applyHtmlContributions(normalized, missing), eol), changed: true };
}

/**
 * Takes the contributions back out of the page.
 *
 * A section comes out only when it is character for character what was put in —
 * between its markers, or, in a page written without them, on its own. Markers around
 * anything else mean the markup was edited, and the edit is refused. So is a page
 * that still has a distinctive line of the markup outside any marker.
 */
export function removeHtmlContributions(html: string, contributions: HtmlContribution[]): PatchResult {
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  let output = eol === '\n' ? html : html.replace(/\r\n/g, '\n');
  let removed = 0;
  const edited = (pluginId: string | undefined, line: string) =>
    refused(
      html,
      `web/index.html has markup ${pluginId ? `the ${pluginId} plugin` : 'this plugin'} added, and it was changed since`,
      pluginId
        ? `Remove everything between ${markerOf(pluginId)} and <!-- /armemon:${pluginId} --> in web/index.html, markers included.`
        : `Remove this plugin's markup from web/index.html yourself — the block containing:\n${line}`,
    );

  for (const contribution of contributions) {
    for (const { entries, where } of sectionsOf(contribution)) {
      const candidates = [
        ...(contribution.pluginId ? [sectionBlock(entries, contribution.pluginId)] : []),
        sectionBlock(entries),
      ];
      const found = candidates.map((block) => `${block}\n`).find((block) => output.includes(block));
      if (found) {
        const at = output.indexOf(found);
        output = output.slice(0, at) + output.slice(at + found.length);
        removed += 1;
        continue;
      }
      if (contribution.pluginId && regionOf(output, where).includes(markerOf(contribution.pluginId))) {
        return edited(contribution.pluginId, '');
      }
      const distinctive = entries
        .flatMap((entry) => entry.split('\n'))
        .map((line) => line.trim())
        .find((line) => line.length > 20 && output.includes(line));
      if (distinctive) return edited(undefined, distinctive);
    }
  }

  return removed === 0 ? done(html, 'web/index.html no longer has this markup') : { content: withEol(output, eol), changed: true };
}
