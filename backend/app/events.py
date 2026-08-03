import asyncio
from collections import defaultdict
from collections.abc import AsyncGenerator
from typing import Any

_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)


async def publish(event_type: str, payload: Any) -> None:
    for queue in _subscribers[event_type]:
        await queue.put({"type": event_type, "payload": payload})
    for queue in _subscribers["*"]:
        await queue.put({"type": event_type, "payload": payload})


async def subscribe(event_type: str = "*") -> AsyncGenerator[dict, None]:
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers[event_type].append(queue)
    try:
        while True:
            yield await queue.get()
    finally:
        _subscribers[event_type].remove(queue)
