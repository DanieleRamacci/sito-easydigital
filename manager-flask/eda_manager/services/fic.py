"""FattureInCloud API v2 client."""
from datetime import date

import requests
from flask import current_app

FIC_BASE = "https://api-v2.fattureincloud.it"

# In-memory cache: company_id → vat_type_id for 22%
_vat_22_cache: dict[str, int] = {}


def _headers() -> dict:
    token = current_app.config.get("FIC_BEARER_TOKEN", "")
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _cid() -> str:
    return str(current_app.config.get("FIC_COMPANY_ID", ""))


def fic_enabled() -> bool:
    return bool(
        current_app.config.get("FIC_BEARER_TOKEN")
        and current_app.config.get("FIC_COMPANY_ID")
    )


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

def search_clients(query: str) -> tuple[list[dict], str]:
    """Search FIC clients by name, VAT or any term."""
    try:
        resp = requests.get(
            f"{FIC_BASE}/c/{_cid()}/entities/clients",
            params={"q": query, "fields": "id,name,vat_number,tax_code,address_city,email"},
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


def fetch_all_clients(max_pages: int = 10) -> tuple[list[dict], str]:
    """Fetch all FIC clients (paginated, up to max_pages × 50 records)."""
    all_clients: list[dict] = []
    for page in range(1, max_pages + 1):
        try:
            resp = requests.get(
                f"{FIC_BASE}/c/{_cid()}/entities/clients",
                params={
                    "page": page,
                    "per_page": 50,
                    "fields": "id,name,vat_number,tax_code,email,address_city",
                },
                headers=_headers(),
                timeout=10,
            )
            if resp.status_code == 401:
                return all_clients, "Token FIC non valido o scaduto."
            if not resp.ok:
                return all_clients, f"Errore API FIC ({resp.status_code})"
            data = resp.json()
            all_clients.extend(data.get("data", []))
            pagination = data.get("pagination", {})
            if page >= pagination.get("last_page", 1):
                break
        except requests.exceptions.Timeout:
            return all_clients, "Timeout connessione a FattureInCloud."
        except Exception as exc:
            return all_clients, f"Errore di rete: {exc}"
    return all_clients, ""


# ---------------------------------------------------------------------------
# VAT types
# ---------------------------------------------------------------------------

def get_vat_type_22() -> tuple[int, str]:
    """Return the FIC vat_type id for 22% IVA ordinaria. Cached per company."""
    cid = _cid()
    if cid in _vat_22_cache:
        return _vat_22_cache[cid], ""
    try:
        resp = requests.get(
            f"{FIC_BASE}/c/{cid}/vat_types",
            headers=_headers(),
            timeout=8,
        )
        if not resp.ok:
            return 0, f"Errore nel recupero aliquote IVA ({resp.status_code})"
        for vt in resp.json().get("data", []):
            if vt.get("value") == 22 and not vt.get("is_disabled"):
                _vat_22_cache[cid] = vt["id"]
                return vt["id"], ""
        return 0, "Aliquota IVA 22% non trovata in FattureInCloud."
    except Exception as exc:
        return 0, f"Errore di rete: {exc}"


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

def get_unpaid_documents(fic_entity_id: int) -> tuple[list[dict], str]:
    """Return all unpaid invoices and proforma for the given FIC entity."""
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
    docs.sort(key=lambda d: d.get("date") or "", reverse=True)
    return docs, error


def get_document(fic_document_id: int) -> tuple[dict, str]:
    """Fetch a single FIC document by ID."""
    try:
        resp = requests.get(
            f"{FIC_BASE}/c/{_cid()}/issued_documents/{fic_document_id}",
            headers=_headers(),
            timeout=8,
        )
        if resp.status_code == 401:
            return {}, "Token FIC non valido o scaduto."
        if resp.status_code == 404:
            return {}, "Documento non trovato in FattureInCloud."
        if not resp.ok:
            return {}, f"Errore API FIC ({resp.status_code})"
        return resp.json().get("data", {}), ""
    except Exception as exc:
        return {}, f"Errore di rete: {exc}"


def create_quote_from_job(job, vat_id: int) -> tuple[dict, str]:
    """Create a FIC quote (preventivo) from a Job.
    Returns (doc_data, error_message).
    """
    customer = job.customer

    # Build entity reference
    if customer and customer.fic_entity_id:
        entity = {"id": customer.fic_entity_id}
    elif customer:
        entity = {
            "name": customer.company or f"{customer.first_name or ''} {customer.last_name or ''}".strip(),
            "vat_number": customer.vat or "",
            "address_street": customer.billing_address or "",
            "certified_email": customer.pec or "",
            "ei_code": customer.sdi or "",
        }
    else:
        entity = {"name": job.title}

    # Build line items from job services, fallback to job amount
    items: list[dict] = []
    if job.services:
        for svc in job.services:
            items.append({
                "name": svc.name,
                "net_price": float(svc.price or 0),
                "qty": 1,
                "vat": {"id": vat_id},
            })
    else:
        items.append({
            "name": job.title,
            "net_price": float(job.amount or 0),
            "qty": 1,
            "vat": {"id": vat_id},
        })

    payload = {
        "data": {
            "type": "quote",
            "date": date.today().isoformat(),
            "entity": entity,
            "items_list": items,
            "notes": job.description or "",
        }
    }

    try:
        resp = requests.post(
            f"{FIC_BASE}/c/{_cid()}/issued_documents",
            json=payload,
            headers=_headers(),
            timeout=10,
        )
        if resp.status_code == 401:
            return {}, "Token FIC non valido."
        if not resp.ok:
            detail = ""
            try:
                detail = resp.json().get("error", {}).get("message", "")
            except Exception:
                pass
            return {}, f"Errore FIC ({resp.status_code}){': ' + detail if detail else ''}"
        return resp.json().get("data", {}), ""
    except requests.exceptions.Timeout:
        return {}, "Timeout connessione FIC."
    except Exception as exc:
        return {}, f"Errore di rete: {exc}"
