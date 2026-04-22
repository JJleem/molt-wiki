import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { SummaryResult } from './summarizer';

const client = new Anthropic();
const MODEL = 'claude-haiku-4-5-20251001';

// molt-wiki/ 루트에서 실행한다고 가정. WIKI_DIR 환경변수로 오버라이드 가능.
const WIKI_ROOT = process.env.WIKI_DIR ?? process.cwd();

function wikiPath(...parts: string[]): string {
  return path.join(WIKI_ROOT, 'wiki', ...parts);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateStamp(): string {
  return today().replace(/-/g, '');
}

async function extractConcepts(summary: string): Promise<string[]> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `다음 요약에서 wiki 개념 페이지로 만들 만한 핵심 개념을 최대 5개 추출하세요.
한 줄에 하나씩, 파일명으로 쓸 수 있게 공백 없이 언더스코어로 연결하세요 (한영 혼용 가능).
예: LLM_파인튜닝, 프롬프트_엔지니어링, RAG

요약:
${summary}

개념 목록만 출력하세요 (설명 없이):`,
      },
    ],
  });

  return (res.content[0] as { text: string }).text
    .split('\n')
    .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function createSourceFile(csvName: string, result: SummaryResult): string {
  const slug = path.basename(csvName, path.extname(csvName));
  const fileName = `${dateStamp()}_${slug}.md`;
  const outPath = wikiPath('sources', fileName);

  const content = `---
tags: [${result.tags.join(', ')}]
date: ${today()}
source_count: ${result.messageCount}
source_file: ${csvName}
---

${result.summary}`;

  fs.writeFileSync(outPath, content, 'utf-8');
  console.log(`  생성: wiki/sources/${fileName}`);
  return `sources/${fileName}`;
}

function upsertConceptFile(conceptName: string, sourceRef: string): void {
  const fileName = `${conceptName}.md`;
  const filePath = wikiPath('concepts', fileName);

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (!existing.includes(sourceRef)) {
      // Sources 섹션이 있으면 거기에 추가, 없으면 파일 끝에 추가
      const updated = existing.includes('## Sources')
        ? existing.replace(/## Sources/, `## Sources\n- [[${sourceRef}]]`)
        : existing + `\n\n## Sources\n\n- [[${sourceRef}]]\n`;
      fs.writeFileSync(filePath, updated, 'utf-8');
      console.log(`  업데이트: wiki/concepts/${fileName}`);
    }
  } else {
    const displayName = conceptName.replace(/_/g, ' ');
    const content = `---
tags: []
date: ${today()}
source_count: 1
---

# ${displayName}

> 카카오톡 채팅 요약에서 추출된 개념입니다. 내용을 직접 보강해주세요.

## Sources

- [[${sourceRef}]]
`;
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  생성: wiki/concepts/${fileName}`);
  }
}

function updateIndex(slug: string, sourceRef: string, tags: string[]): void {
  const indexPath = wikiPath('index.md');
  const existing = fs.readFileSync(indexPath, 'utf-8');
  const tagStr = tags.slice(0, 3).join(', ');
  const entry = `- [${today()} — ${slug}](${sourceRef}) \`${tagStr}\``;
  const section = '## Chat Logs';

  let updated: string;
  if (existing.includes(section)) {
    updated = existing.replace(section, `${section}\n\n${entry}`);
  } else {
    updated = existing.trimEnd() + `\n\n${section}\n\n${entry}\n`;
  }

  fs.writeFileSync(indexPath, updated, 'utf-8');
  console.log('  업데이트: wiki/index.md');
}

function updateLog(csvName: string, messageCount: number): void {
  const logPath = wikiPath('log.md');
  const existing = fs.readFileSync(logPath, 'utf-8');
  const entry = `## [${today()}] ingest | ${csvName} (${messageCount}개 메시지)\n`;

  // --- 구분자 바로 다음에 삽입
  const updated = existing.includes('\n---\n')
    ? existing.replace('\n---\n', `\n---\n\n${entry}`)
    : existing + `\n${entry}`;

  fs.writeFileSync(logPath, updated, 'utf-8');
  console.log('  업데이트: wiki/log.md');
}

export async function ingest(csvPath: string, result: SummaryResult): Promise<void> {
  const csvName = path.basename(csvPath);
  const slug = path.basename(csvPath, path.extname(csvPath));

  console.log('\n[Ingest]');

  const sourceRef = createSourceFile(csvName, result);

  console.log('  개념 추출 중...');
  const concepts = await extractConcepts(result.summary);
  for (const concept of concepts) {
    upsertConceptFile(concept, sourceRef);
  }

  updateIndex(slug, sourceRef, result.tags);
  updateLog(csvName, result.messageCount);
}
