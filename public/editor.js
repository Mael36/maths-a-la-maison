const container = document.getElementById('editorContainer');
let data = {};
let currentCategoryForAdd = ''; // Pour savoir dans quelle cat ajouter

fetch('/data.json')
  .then(res => res.json())
  .then(loadedData => {
    data = loadedData;
    buildEditor();
  })
  .catch(() => {
    container.textContent = 'Erreur de chargement des questions';
  });

function buildEditor() {
  container.innerHTML = '';
  Object.entries(data).forEach(([category, questions]) => {
    const cat = document.createElement('div');
    cat.className = 'category';

    const header = document.createElement('div');
    header.className = 'category-header';
    header.textContent = `▶ ${category} (${questions.length} questions)`;

    const content = document.createElement('div');
    content.className = 'category-content';

    const editCatBtn = document.createElement('button');
    editCatBtn.textContent = 'Modifier nom catégorie';
    editCatBtn.onclick = () => editCategoryName(category);
    header.appendChild(editCatBtn);

    const deleteCatBtn = document.createElement('button');
    deleteCatBtn.textContent = 'Supprimer catégorie';
    deleteCatBtn.onclick = () => deleteCategory(category);
    header.appendChild(deleteCatBtn);

    const addQBtn = document.createElement('button');
    addQBtn.textContent = 'Ajouter une question';
    addQBtn.onclick = () => openAddModal(category);
    header.appendChild(addQBtn);

    header.onclick = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const open = content.style.display === 'block';
      content.style.display = open ? 'none' : 'block';
      header.firstChild.textContent = `${open ? '▶' : '▼'} ${category} (${questions.length} questions)`;
    };

    questions.forEach((q, index) => {
      const block = document.createElement('div');
      block.className = 'question-block';

      const num = document.createElement('div');
      num.className = 'question-number';
      num.textContent = `Question ${index + 1}`;
      block.appendChild(num);

      const questionP = document.createElement('p');
      questionP.textContent = q.q;
      block.appendChild(questionP);

      if (q.img) {
        const img = document.createElement('img');
        img.src = q.img.replace('./', '/');
        block.appendChild(img);
      }

      const editSection = document.createElement('div');
      editSection.style.display = 'none';

      const qInput = createTextInput('Question (q):', q.q, 'textarea');
      const aInput = createTextInput('Réponse (a):', q.a, 'textarea');
      const dInput = createTextInput('Détails (d, facultatif):', q.d || '', 'textarea');
      const imgInput = createFileInput('Image question (img, facultatif, actuel: ' + (q.img || 'aucune') + '):');
      const imgrepInput = createFileInput('Image réponse (imgrep, facultatif, actuel: ' + (q.imgrep || 'aucune') + '):');

      editSection.appendChild(qInput);
      editSection.appendChild(aInput);
      editSection.appendChild(dInput);
      editSection.appendChild(imgInput);
      editSection.appendChild(imgrepInput);

      block.appendChild(editSection);

      const editBtn = document.createElement('button');
      editBtn.className = 'reveal-btn';
      editBtn.textContent = 'Modifier';
      editBtn.onclick = () => {
        const visible = editSection.style.display === 'block';
        editSection.style.display = visible ? 'none' : 'block';
        editBtn.textContent = visible ? 'Modifier' : 'Cacher édition';
      };
      block.appendChild(editBtn);

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Sauvegarder question';
      saveBtn.onclick = () => uploadAndSaveQuestion(category, index, qInput, aInput, dInput, imgInput, imgrepInput, true);
      block.appendChild(saveBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Supprimer question';
      deleteBtn.onclick = () => deleteQuestion(category, index);
      block.appendChild(deleteBtn);

      content.appendChild(block);
    });

    cat.appendChild(header);
    cat.appendChild(content);
    container.appendChild(cat);
  });
}

// Helper pour input text/textarea
function createTextInput(labelText, value, type = 'textarea') {
  const div = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement(type);
  if (type === 'textarea') input.value = value;
  else input.value = value;
  div.appendChild(label);
  div.appendChild(input);
  return div;
}

// Helper pour input file
function createFileInput(labelText) {
  const div = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  div.appendChild(label);
  div.appendChild(input);
  return div;
}

// Ouvrir modal add
function openAddModal(category) {
  currentCategoryForAdd = category;
  document.getElementById('addQuestionModal').style.display = 'block';
  document.getElementById('addQuestionForm').reset();
}

// Fermer modal
function closeAddModal() {
  document.getElementById('addQuestionModal').style.display = 'none';
}

// Submit add form
document.getElementById('addQuestionForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const qInput = document.getElementById('addQ').closest('div');
  const aInput = document.getElementById('addA').closest('div');
  const dInput = document.getElementById('addD').closest('div');
  const imgInput = document.getElementById('addImg').closest('div');
  const imgrepInput = document.getElementById('addImgrep').closest('div');
  uploadAndSaveQuestion(currentCategoryForAdd, null, qInput, aInput, dInput, imgInput, imgrepInput, false);
  closeAddModal();
});

// Fonction commune pour upload + save (edit ou add)
async function uploadAndSaveQuestion(category, index, qDiv, aDiv, dDiv, imgDiv, imgrepDiv, isEdit) {
  const q = qDiv.querySelector('textarea, input').value;
  const a = aDiv.querySelector('textarea, input').value;
  const d = dDiv.querySelector('textarea, input').value || undefined;

  if (!q || !a) return alert('Question et réponse obligatoires.');

  const formData = new FormData();
  formData.append('category', category);
  formData.append('q', q);
  formData.append('a', a);
  if (d) formData.append('d', d);
  formData.append('isEdit', isEdit);
  if (isEdit) formData.append('index', index);

  const imgFile = imgDiv.querySelector('input[type="file"]');
  if (imgFile.files.length) formData.append('img', imgFile.files[0]);

  const imgrepFile = imgrepDiv.querySelector('input[type="file"]');
  if (imgrepFile.files.length) formData.append('imgrep', imgrepFile.files[0]);

  const response = await fetch('/upload-and-save-question', {
    method: 'POST',
    body: formData
  });
  const result = await response.json();
  if (result.success) {
    // Recharge data.json et rebuild
    fetch('/data.json')
      .then(res => res.json())
      .then(loadedData => {
        data = loadedData;
        buildEditor();
      });
    alert('Question sauvegardée !');
  } else {
    alert(result.error || 'Erreur lors de la sauvegarde.');
  }
}

// Éditer nom catégorie
function editCategoryName(oldName) {
  const newName = prompt('Nouveau nom de la catégorie :', oldName);
  if (newName && newName !== oldName) {
    data[newName] = data[oldName];
    delete data[oldName];
    buildEditor();
  }
}

// Supprimer catégorie
function deleteCategory(category) {
  if (confirm(`Supprimer la catégorie "${category}" ?`)) {
    delete data[category];
    buildEditor();
  }
}

// Ajouter catégorie
document.getElementById('add-category-btn').addEventListener('click', () => {
  const name = prompt('Nom de la nouvelle catégorie :');
  if (name && !data[name]) {
    data[name] = [];
    buildEditor();
  }
});

// Supprimer question
function deleteQuestion(category, index) {
  if (confirm('Supprimer cette question ?')) {
    data[category].splice(index, 1);
    buildEditor();
  }
}

// Sauvegarder tout (sans images, pour global)
document.getElementById('save-all-btn').addEventListener('click', async () => {
  const response = await fetch('/save-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (result.success) {
    alert('Tout sauvegardé !');
  } else {
    alert(result.error || 'Erreur lors de la sauvegarde.');
  }

});
