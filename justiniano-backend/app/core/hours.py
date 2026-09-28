"""Horas hábiles (§4.2): lun–vie 09:00–18:00 America/Santiago, feriados CL."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Santiago")
HOLIDAYS_2026 = {"2026-01-01", "2026-04-03", "2026-04-04", "2026-05-01", "2026-05-21",
                 "2026-06-29", "2026-07-16", "2026-08-15", "2026-09-18", "2026-09-19",
                 "2026-10-12", "2026-10-31", "2026-11-01", "2026-12-08", "2026-12-25"}
DAY_START, DAY_END = 9, 18


def _is_business_day(d: datetime) -> bool:
    return d.weekday() < 5 and d.strftime("%Y-%m-%d") not in HOLIDAYS_2026


def add_business_hours(start_utc: datetime, hours: float) -> datetime:
    """Suma horas hábiles y devuelve el vencimiento en UTC."""
    t = start_utc.astimezone(TZ)
    remaining = timedelta(hours=hours)
    while remaining > timedelta(0):
        if _is_business_day(t) and DAY_START <= t.hour < DAY_END:
            end_of_day = t.replace(hour=DAY_END, minute=0, second=0, microsecond=0)
            step = min(remaining, end_of_day - t)
            t += step
            remaining -= step
        else:  # saltar al próximo bloque hábil
            t = (t + timedelta(days=1) if t.hour >= DAY_END else t).replace(
                hour=DAY_START, minute=0, second=0, microsecond=0)
            while not _is_business_day(t):
                t += timedelta(days=1)
    return t.astimezone(ZoneInfo("UTC"))


def business_hours_between(a: datetime, b: datetime) -> float:
    """Horas hábiles entre dos instantes (aprox. por pasos de 15 min)."""
    if b <= a:
        return 0.0
    t, total, step = a.astimezone(TZ), 0.0, timedelta(minutes=15)
    end = b.astimezone(TZ)
    while t < end:
        if _is_business_day(t) and DAY_START <= t.hour < DAY_END:
            total += 0.25
        t += step
    return round(total, 2)
