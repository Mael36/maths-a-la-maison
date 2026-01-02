import json
import requests
import os

MISTRAL_API_KEY = "UgqBwDkleUS5rgEDyCnWYoZOhEHH916x"  

API_URL = "https://api.mistral.ai/v1/chat/completions"


# ===============================
# Chargement des questions
# ===============================
def load_questions(filename="questionspropre.json"):
    """
    Charge un JSON au format :
    [
      { "id": ..., "q": "...", "a": "...", "d": "..."? },
      ...
    ]
    """
    with open(filename, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Nouveau format : liste directe
    if isinstance(data, list):
        return data

    # Sécurité si jamais un ancien format traîne encore
    questions = []
    for value in data.values():
        if isinstance(value, list):
            questions.extend(value)

    return questions


# ===============================
# Recherche par ID
# ===============================
def find_question_by_id(questions, q_id):
    for q in questions:
        if q.get("id") == q_id:
            return q
    return None


# ===============================
# Comparaison via Mistral
# ===============================
def comparer_reponses(reponse_utilisateur, reponse_attendue):
    if not MISTRAL_API_KEY:
        print("⚠️ Clé API Mistral manquante.")
        return None

    headers = {
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json"
    }

    prompt = f"""
Tu es un évaluateur strict mais juste.

Compare les deux réponses suivantes à une question de mathématiques.

Réponse attendue (référence) :
{reponse_attendue}

Réponse de l'utilisateur :
{reponse_utilisateur}

Règles :
- Réponds UNIQUEMENT par "true" ou "false"
- true si les réponses sont équivalentes mathématiquement ou sémantiquement
- false si la réponse est fausse, incomplète ou hors sujet
- false si l'utilisateur répond par des phrases vagues comme :
  "c'est la même réponse", "idem", "voir question", etc.
- false si l'utilisateur reformule la question au lieu de répondre

Aucune explication. Un seul mot : true ou false.
""".strip()

    payload = {
        "model": "mistral-small-latest",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 5
    }

    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=15)
        response.raise_for_status()

        result = response.json()
        answer = result["choices"][0]["message"]["content"].strip().lower()

        if answer in ("true", "vrai"):
            return True
        if answer in ("false", "faux"):
            return False

        print(f"⚠️ Réponse inattendue du modèle : {answer}")
        return None

    except Exception as e:
        print(f"❌ Erreur API Mistral : {e}")
        return None


# ===============================
# Programme principal
# ===============================
def main():
    questions = load_questions()

    print("=== Vérification de réponse avec Mistral AI ===\n")

    try:
        q_id = int(input("Entrez l'ID de la question : "))
    except ValueError:
        print("⚠️ ID invalide (nombre attendu).")
        return

    question = find_question_by_id(questions, q_id)
    if not question:
        print(f"⚠️ Aucune question trouvée avec l'ID {q_id}.")
        return

    question_text = question.get("q", "").strip()
    expected_answer = question.get("a", "").strip()
    detail = question.get("d", "").strip()  # optionnel, pas utilisé pour l’instant

    print(f"\nQuestion (ID {q_id}) :\n{question_text}\n")

    user_answer = input("✏️  Ta réponse : ").strip()

    print("\n" + "=" * 50)
    print("RÉCAPITULATIF")
    print("=" * 50)
    print(f"Ta réponse       : {user_answer if user_answer else '(vide)'}")
    print(f"Réponse attendue : {expected_answer}")
    print("=" * 50)

    if not user_answer:
        print("\n❌ Résultat : false (réponse vide)")
        return

    if not expected_answer:
        print("\n⚠️ Pas de comparaison possible (réponse attendue absente)")
        return

    print("\n🔄 Comparaison en cours avec Mistral AI...")
    resultat = comparer_reponses(user_answer, expected_answer)

    if resultat is True:
        print("✅ Résultat : true")
    elif resultat is False:
        print("❌ Résultat : false")
        # Plus tard tu pourras afficher `detail` ici
    else:
        print("⚠️ Résultat indéterminé")


if __name__ == "__main__":
    main()