// public/revision.js

const container = document.getElementById('revisionContainer');

async function loadRevision() {
  try {
    const res = await fetch('/data.json');
    const data = await res.json();

    container.innerHTML = '';

    Object.entries(data).forEach(([theme, questions]) => {
      // Titre de catégorie
      const themeTitle = document.createElement('h2');
      themeTitle.textContent = theme;
      container.appendChild(themeTitle);

      questions.forEach((q, index) => {
        const block = document.createElement('div');
        block.className = 'revisionQuestion';

        // --- Question texte ---
        if (q.q) {
          const question = document.createElement('p');
          question.innerHTML = `<strong>Q${index + 1} :</strong> ${q.q}`;
          block.appendChild(question);
        }

        // --- Image de la question ---
        if (q.img) {
          const img = document.createElement('img');
          img.src = q.img;
          img.alt = 'Illustration question';
          img.className = 'revisionImage';
          block.appendChild(img);
        }

        // --- Réponse texte ---
        if (q.a) {
          const answer = document.createElement('p');
          answer.innerHTML = `<strong>Réponse :</strong> ${q.a}`;
          answer.className = 'revisionAnswer';
          block.appendChild(answer);
        }

        // --- Détail / explication ---
        if (q.d) {
          const detail = document.createElement('p');
          detail.innerHTML = `<strong>Détail :</strong> ${q.d}`;
          detail.className = 'revisionDetail';
          block.appendChild(detail);
        }

        // --- Image de correction ---
        if (q.imgrep) {
          const imgRep = document.createElement('img');
          imgRep.src = q.imgrep;
          imgRep.alt = 'Correction';
          imgRep.className = 'revisionImage';
          block.appendChild(imgRep);
        }

        container.appendChild(block);
      });
    });

  } catch (err) {
    console.error(err);
    container.textContent = 'Erreur de chargement des questions';
  }
}

loadRevision();
