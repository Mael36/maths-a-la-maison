const container = document.getElementById('revisionContainer');

fetch('/data.json')
  .then(res => res.json())
  .then(data => buildRevision(data))
  .catch(() => {
    container.textContent = 'Erreur de chargement des questions';
  });

function buildRevision(data) {
  Object.entries(data).forEach(([category, questions]) => {
    // catégorie
    const cat = document.createElement('div');
    cat.className = 'category';

    const header = document.createElement('div');
    header.className = 'category-header';
    header.textContent = `▶ ${category} (${questions.length} questions)`;

    const content = document.createElement('div');
    content.className = 'category-content';

    header.onclick = () => {
      const open = content.style.display === 'block';
      content.style.display = open ? 'none' : 'block';
      header.textContent = `${open ? '▶' : '▼'} ${category} (${questions.length} questions)`;
    };

    questions.forEach((q, index) => {
      const block = document.createElement('div');
      block.className = 'question-block';

      // numéro
      const num = document.createElement('div');
      num.className = 'question-number';
      num.textContent = `Question ${index + 1}`;
      block.appendChild(num);

      const question = document.createElement('p');
      question.textContent = q.q;
      block.appendChild(question);

      if (q.img) {
        const img = document.createElement('img');
        img.src = q.img.replace('./', '/');
        block.appendChild(img);
      }

      const btn = document.createElement('button');
      btn.className = 'reveal-btn';
      btn.textContent = 'Voir la réponse';

      const answer = document.createElement('div');
      answer.className = 'answer';

      const repText = document.createElement('p');
      repText.textContent = `Réponse : ${q.a}`;
      answer.appendChild(repText);

      if (q.d) {
        const detail = document.createElement('p');
        detail.textContent = q.d;
        answer.appendChild(detail);
      }

      if (q.imgrep) {
        const imgRep = document.createElement('img');
        imgRep.src = q.imgrep.replace('./', '/');
        answer.appendChild(imgRep);
      }

      btn.onclick = () => {
        const visible = answer.style.display === 'block';
        answer.style.display = visible ? 'none' : 'block';
        btn.textContent = visible ? 'Voir la réponse' : 'Cacher la réponse';
      };

      block.appendChild(btn);
      block.appendChild(answer);
      content.appendChild(block);
    });

    cat.appendChild(header);
    cat.appendChild(content);
    container.appendChild(cat);
  });
}
