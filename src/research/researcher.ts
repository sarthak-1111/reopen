import { CloudBlockedError, buildCloudPayload, type CloudBlockCode, type CloudGate, type CloudRequest } from '../ai/cloud-gate';
import type { InferenceBadge } from '../ai/contract';
import { compileSchema, extractJson } from '../ai/structured';
import { proposeName } from '../core/naming';
import type { Block, ConversionLevel, OutputFile, RescueResult } from '../core/types';
import { blocksToMarkdown } from '../core/writers/markdown';
import { docxBytes } from '../core/writers/docx';
import { runConformance, type ConformanceOptions, type ConformanceReport, type SampleFile } from './conformance';
import { readWithPlugin, type PluginBlock } from './interpreter';
import { READER_PLUGIN_SCHEMA, semanticProblems, type ReaderPlugin } from './plugin-schema';

/** Fixed instructions sent with the user's public documentation. Contains no user data. */
export const RESEARCH_INSTRUCTIONS = [
  'You are helping an offline file-rescue app read an old file format.',
  'Below is PUBLIC documentation for the format, supplied by the user. No file contents are included, and none will be.',
  'Draft a declarative reader plugin as JSON that matches the response schema. It is data, not code.',
  'Rules:',
  '- magic: the signature bytes and their offset (ascii, or hex like "51 4E 42 31").',
  '- header: fields at absolute byte offsets. Numbers are u8/u16/u32/i16/i32 in the given endianness.',
  '  Text fields need "length" (fixed) or "lengthFrom" (an EARLIER numeric field). Use "xor" if the documentation says bytes are XOR-ed.',
  '- headerLength: total size of the fixed header in bytes, if documented.',
  '- body.kind "records": records follow one another; list recordFields in order; textField names the text field;',
  '  kindField + kindMap map a numeric record type to heading / paragraph / list-item; until is "count" (with countFrom) or "end-of-file".',
  '- body.kind "text-block": one block of text at textOffset/textOffsetFrom with textLength/textLengthFrom.',
  '- titleField and dateFields name header fields when the documentation has them.',
  '- Only describe what the documentation says. Put any uncertainty in "notes".',
  'Answer with the JSON object only.',
].join('\n');

const validatePlugin = compileSchema<ReaderPlugin>(READER_PLUGIN_SCHEMA);

export type DraftFailureCode = 'blocked' | 'model-error' | 'invalid-json' | 'invalid-plugin';

export type DraftResult =
  | { ok: true; plugin: ReaderPlugin; badge: InferenceBadge; ledgerId: string }
  | { ok: false; code: DraftFailureCode; message: string; problems: string[]; blockCode?: CloudBlockCode; badge?: InferenceBadge; raw?: string };

/** Validates untrusted JSON as a plugin (schema + semantic checks). */
export function parsePlugin(text: string): { plugin?: ReaderPlugin; code?: 'invalid-json' | 'invalid-plugin'; problems: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(extractJson(text));
  } catch {
    return { code: 'invalid-json', problems: ['The answer was not valid JSON.'] };
  }
  if (!validatePlugin(data)) {
    return { code: 'invalid-plugin', problems: (validatePlugin.errors ?? []).map((e) => `${e.instancePath || 'plugin'} ${e.message ?? 'is invalid'}`) };
  }
  const problems = semanticProblems(data);
  return problems.length ? { code: 'invalid-plugin', problems } : { plugin: data, problems: [] };
}

export interface Researcher {
  prepare(docName: string, docText: string): { request: CloudRequest; payload: string };
  draft(request: CloudRequest, consentToken: string): Promise<DraftResult>;
  certify(plugin: ReaderPlugin, samples: readonly SampleFile[], options?: ConformanceOptions): ConformanceReport;
  apply(plugin: ReaderPlugin, sample: SampleFile, context: { docName: string; badge: InferenceBadge }): Promise<RescueResult>;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function toCoreBlocks(blocks: readonly PluginBlock[]): Block[] {
  return blocks.map((b): Block => (b.kind === 'heading' ? { type: 'heading', level: 2, text: b.text } : b.kind === 'list-item' ? { type: 'list-item', text: b.text, ordered: false } : { type: 'paragraph', text: b.text }));
}

export function createResearcher(gate: CloudGate): Researcher {
  return {
    prepare(docName, docText) {
      const request: CloudRequest = {
        feature: 'format-research',
        instructions: RESEARCH_INSTRUCTIONS,
        docName: docName.trim() || 'Public format documentation',
        docText,
        schema: READER_PLUGIN_SCHEMA,
      };
      return { request, payload: buildCloudPayload(request) };
    },

    async draft(request, consentToken) {
      let text: string;
      let badge: InferenceBadge;
      let ledgerId: string;
      try {
        const result = await gate.send(request, consentToken);
        text = result.text;
        badge = result.badge;
        ledgerId = result.ledgerId;
      } catch (error) {
        if (error instanceof CloudBlockedError) {
          return { ok: false, code: 'blocked', blockCode: error.code, message: error.message, problems: [] };
        }
        return { ok: false, code: 'model-error', message: `The cloud model could not be reached: ${error instanceof Error ? error.message : String(error)}`, problems: [] };
      }
      const parsed = parsePlugin(text);
      if (!parsed.plugin) {
        return {
          ok: false,
          code: parsed.code ?? 'invalid-plugin',
          message: 'The drafted reader is not valid, so it will not be used. You can try again (this needs your consent again).',
          problems: parsed.problems,
          badge,
          raw: text,
        };
      }
      return { ok: true, plugin: parsed.plugin, badge, ledgerId };
    },

    certify(plugin, samples, options) {
      return runConformance(plugin, samples, options);
    },

    async apply(plugin, sample, context) {
      const read = readWithPlugin(plugin, sample.bytes);
      const blocks = toCoreBlocks(read.blocks);
      const titleText = read.title ?? '';
      const allText = [titleText, ...read.blocks.map((b) => b.text)].join('\n');
      const proposed = proposeName({ title: [read.date, titleText].filter(Boolean).join(' ') || undefined, text: allText, originalName: sample.name });
      const note = `Read on this device with a reader drafted by cloud Gemini from public documentation ("${context.docName}"). Only that documentation was sent to the cloud; this file never left your computer.`;
      const title = titleText || undefined;
      const outputs: OutputFile[] = read.ok
        ? [
            { name: `${proposed}.md`, mime: 'text/markdown;charset=utf-8', bytes: new TextEncoder().encode(blocksToMarkdown(blocks, { ...(title ? { title } : {}), note })) },
            { name: `${proposed}.docx`, mime: DOCX_MIME, bytes: await docxBytes(blocks, { ...(title ? { title } : {}), note }) },
          ]
        : [];
      const level: ConversionLevel = !read.ok ? 'none' : read.blocks.some((b) => b.kind !== 'paragraph') ? 'full' : 'text-and-paragraphs';
      return {
        source: { path: sample.name, size: sample.bytes.length },
        detected: {
          format: 'unknown',
          family: 'document',
          evidence: [
            `Signature matches “${plugin.formatName}” (${plugin.formatVersion}).`,
            `Read with a reader drafted from public documentation (“${context.docName}”) and certified by local conformance tests.`,
          ],
          confidence: read.ok ? 1 : 0,
        },
        proposedName: proposed,
        outputs,
        structure: blocks,
        warnings: [...read.warnings, ...read.errors, `AI badge ${context.badge === 'CLOUD' ? 'CLOUD' : context.badge}: only the public documentation went to the cloud; this file was read locally.`],
        conversionLevel: level,
      };
    },
  };
}
