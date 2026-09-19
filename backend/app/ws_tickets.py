import secrets
import time

_TICKET_TTL = 30  # seconds — long enough to open the socket, short enough to be useless if leaked
_tickets: dict[str, float] = {}  # ticket → expiry as monotonic timestamp


def issue_ticket() -> str:
    _prune()
    ticket = secrets.token_urlsafe(32)
    _tickets[ticket] = time.monotonic() + _TICKET_TTL
    return ticket


def consume_ticket(ticket: str) -> bool:
    """Validates and removes the ticket in one step — each ticket is single-use."""
    _prune()
    expiry = _tickets.pop(ticket, None)
    return expiry is not None and expiry > time.monotonic()


def _prune() -> None:
    now = time.monotonic()
    stale = [t for t, exp in _tickets.items() if exp <= now]
    for t in stale:
        del _tickets[t]
