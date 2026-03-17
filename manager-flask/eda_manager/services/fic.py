"""FattureInCloud API v2 client — read-only helpers."""
import requests
from flask import current_app

FIC_BASE = "https://api-v2.fattureincloud.it"


def _headers() -> dict:
    token = current_app.config.get("FIC_BEARER_TOKEN", "")
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _cid() -> str:
    return str(current_app.config.get("FIC_COMPANY_ID", ""))


def fic_enabled() -> bool:
    """Returns True only when both token and company_id are configured."""
    return bool(
        current_app.config.get("FIC_BEARER_TOKEN")
        and current_app.config.get("FIC_COMPANY_ID")
    )


def search_clients(query: str) -> tuple[list[dict], str]:
    """Search FIC clients by name, VAT or any term.
    Returns (results, error_message). error_message is empty on success.
    """
    try:
        resp = requests.get(
            f"{FIC_BASE}/c/{_cid()}/entities/clients",
            params={"q": query, "fields": "id,name,vat_number,tax_code,address_city"},
            headers=_headers(),
            timeout=8,
        )
        if resp.status_code == 401:
            return [], "Token FIC non valido o scaduto."
        if not resp.ok:
            return [], f"Errore API FIC ({resp.status_code})"
        return resp.json().get("data", []), ""
    except requests.exceptions.Timeout:
        return [], "Timeout connessione a FattureInCloud."
    except Exception as exc:
        return [], f"Errore di rete: {exc}"


def get_unpaid_documents(fic_entity_id: int) -> tuple[list[dict], str]:
    """Return all unpaid invoices and proforma for the given FIC entity.
    Returns (docs, error_message). Each doc dict is enriched with a 'doc_type' key.
    """
    docs: list[dict] = []
    error = ""

    for doc_type in ("invoice", "proforma"):
        try:
            resp = requests.get(
                f"{FIC_BASE}/c/{_cid()}/issued_documents",
                params={
                    "type": doc_type,
                    "entity_id": fic_entity_id,
                    "fields": "id,type,date,number,numeration,status,amount_gross,amount_net,entity,payments_list",
                },
                headers=_headers(),
                timeout=8,
            )
            if resp.status_code == 401:
                return [], "Token FIC non valido o scaduto."
            if not resp.ok:
                error = f"Errore API FIC ({resp.status_code})"
                continue
            for d in resp.json().get("data", []):
                if d.get("status") in ("not_paid", None, ""):
                    d["doc_type"] = doc_type
                    docs.append(d)
        except requests.exceptions.Timeout:
            return [], "Timeout connessione a FattureInCloud."
        except Exception as exc:
            return [], f"Errore di rete: {exc}"

    # Sort by date descending
    docs.sort(key=lambda d: d.get("date") or "", reverse=True)
    return docs, error
