"""Check that Typesense is set up and that visits are landing in it.

    python check_typesense.py

1. Connects to the cluster from your .env
2. Lists each collection and how many documents it holds
3. Runs a few sample searches (keyword, synonym, Korean, meaning-based)
"""
import sys

import httpx

import config

OK, BAD = "[ OK ]", "[FAIL]"


def main():
    if not config.TYPESENSE_URL:
        sys.exit(f"{BAD} TYPESENSE_HOST is empty in backend/.env")
    c = httpx.Client(base_url=config.TYPESENSE_URL, timeout=30,
                     headers={"X-TYPESENSE-API-KEY": config.TYPESENSE_API_KEY})

    # 1. connection + key
    try:
        r = c.get("/health")
        print(f"{OK if r.json().get('ok') else BAD} cluster reachable at {config.TYPESENSE_URL}")
    except Exception as e:
        sys.exit(f"{BAD} can't reach {config.TYPESENSE_URL}: {e}\n"
                 "       Check TYPESENSE_HOST (no https://, no trailing slash) and your internet.")
    r = c.get("/collections")
    if r.status_code == 401:
        sys.exit(f"{BAD} API key rejected (401). Use the Admin API key from the Typesense Cloud cluster page.")

    # 2. collections + counts
    have = {col["name"]: col for col in r.json()}
    wanted = ["visit_chunks", "visits", "medications", "exercises", "care_items"]
    print("\nCollections:")
    for name in wanted:
        if name in have:
            print(f"  {OK} {name:13s} {have[name]['num_documents']:4d} documents")
        else:
            print(f"  {BAD} {name:13s} missing -> run: python search_index.py setup")
    if not all(n in have for n in wanted):
        return
    if have["visits"]["num_documents"] == 0:
        print("\n  No visits yet. Run a demo visit in the app and tap End visit, then run this again.")
        return

    # 3. sample searches
    def has_embedding(coll):
        return any(f["name"] == "embedding" for f in have[coll]["fields"])

    def search(label, coll, q, query_by, show):
        params = {"q": q, "query_by": query_by, "per_page": 3}
        if "embedding" in query_by:
            params["exclude_fields"] = "embedding"
        r = c.get(f"/collections/{coll}/documents/search", params=params)
        if not r.is_success:
            print(f"  {BAD} {label}: {r.text[:150]}")
            return
        hits = r.json().get("hits", [])
        mark = OK if hits else "[none]"
        top = "; ".join(str(h["document"].get(show, ""))[:60] for h in hits) or "no matches"
        print(f"  {mark} {label:38s} -> {top}")

    print("\nSearches (results depend on which demo visits you've run):")
    search('keyword: "meloxicam"', "medications", "meloxicam", "name,generic_name", "name")
    search('synonym: "blood thinner" (-> apixaban)', "medications", "blood thinner",
           "name,generic_name,purpose", "name")
    search('Korean: "무릎" (knee)', "visit_chunks", "무릎", "text_patient_lang", "text_patient_lang")
    if has_embedding("visit_chunks"):
        search('meaning: "when can my son play sports"', "visit_chunks", "when can my son play sports",
               "embedding", "text_doctor_lang")
    else:
        print("  [skip] meaning-based search (TYPESENSE_EMBED_MODEL=off)")
    search('follow-ups and warnings', "care_items", "*", "text", "text")


if __name__ == "__main__":
    main()
