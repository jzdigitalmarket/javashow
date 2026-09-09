import fs from 'fs';
import path from 'path';

// Ajuste o nome da pasta de imagens se for diferente de 'imagens'
const dirPath = path.join(process.cwd(), 'imagens');
const outputPath = path.join(process.cwd(), 'images.json');

try {
  const files = fs.readdirSync(dirPath).filter(file => file.toLowerCase().endsWith('.jpg'));
  fs.writeFileSync(outputPath, JSON.stringify(files, null, 2));
  console.log(`images.json gerado com ${files.length} imagem(ns).`);
} catch (err) {
  console.error('Erro ao ler diretório de imagens:', err);
  // Cria arquivo vazio para não quebrar a build
  fs.writeFileSync(outputPath, JSON.stringify([]));
}
