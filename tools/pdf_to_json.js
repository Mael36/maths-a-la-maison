import fs from 'fs-extra';
import pdf from 'pdf-parse';

async function extract(pdfPath) {
  const dataBuffer = await fs.readFile(pdfPath);
  const data = await pdf(dataBuffer);
  const text = data.text.replace(/\r/g, '\n');

  // Heuristique pour extraire les cartes
  const cards = [];
  const cardRegex = /Carte n°\s*(\d+)\s*-\s*([^\n\r]+)\n([\s\S]*?)(?=Carte n°\s*\d+|Correction n°\s*\d+|$)/gi;
  let match;
  while ((match = cardRegex.exec(text)) !== null) {
    const id = match[1].trim();
    const category = match[2].trim();
    const question = match[3]
      .replace(/"/g, 'x') // Remplace les " par x
      .replace(/!/g, '²') // Remplace les ! par ²
      .replace(/www\.mathsalamaison\.fr/g, '') // Supprime les URL inutiles
      .trim();
    cards.push({ id, category, question });
  }

  // Heuristique pour extraire les corrections
  const corrections = {};
  const correctionRegex = /Correction n°\s*(\d+)\s*\n([\s\S]*?)(?=Correction n°\s*\d+|Carte n°\s*\d+|$)/gi;
  while ((match = correctionRegex.exec(text)) !== null) {
    const id = match[1].trim();
    const answer = match[2]
      .replace(/"/g, 'x') // Remplace les " par x
      .replace(/!/g, '²') // Remplace les ! par ²
      .replace(/www\.mathsalamaison\.fr/g, '') // Supprime les URL inutiles
      .trim();
    corrections[id] = answer;
  }

  // Associer les corrections aux cartes
  const output = cards.map(card => ({
    id: card.id,
    category: card.category,
    question: card.question,
    answer: corrections[card.id] || null,
  }));

  // Trier par catégorie
  const groupedByCategory = output.reduce((acc, card) => {
    if (!acc[card.category]) acc[card.category] = [];
    acc[card.category].push(card);
    return acc;
  }, {});

  return groupedByCategory;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('Usage: node pdf_to_json.js input.pdf output.json');
    process.exit(2);
  }
  const [pdfPath, outPath] = argv;
  if (!fs.existsSync(pdfPath)) {
    console.error('PDF introuvable :', pdfPath);
    process.exit(3);
  }
  console.log('Extraction en cours depuis', pdfPath);
  const groupedData = await extract(pdfPath);
  await fs.ensureDir(outPath.substring(0, outPath.lastIndexOf('/')));
  await fs.writeJson(outPath, { generatedAt: new Date().toISOString(), data: groupedData }, { spaces: 2 });
  console.log('Exporté les données dans', outPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});