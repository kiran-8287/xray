import fs from 'node:fs';
const content = fs.readFileSync('C:/Users/saikiran/Desktop/xray/combined_page_documentation.tex', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
  const m = line.match(/\\(?:section|subsection)\{/);
  if (m) console.log((i + 1) + ': ' + line.trim());
});