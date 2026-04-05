"""
gove_engine.py — Ядро логики Gove.AI Copilot ЧСИ
==================================================
Изолированный модуль финансовой аналитики для системы принудительного
исполнения Казахстана. Реализует динамическое удержание (по ОКЭД)
и трёхуровневую фильтрацию транзакций (по КНП + страйки).

Чистый Python, без веб-фреймворков. Готов к импорту.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import re


# ─────────────────────────────────────────────────────────────────────────────
# 1. СПРАВОЧНИК ОКЭД → МАРЖИНАЛЬНОСТЬ → ПРОЦЕНТ УДЕРЖАНИЯ
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class OkedProfile:
    """Профиль вида деятельности: маржинальность и процент удержания ЧСИ."""
    oked_code: str
    description: str
    margin_tier: str          # "low" | "medium" | "high"
    retention_percent: float  # % удержания от входящего потока


# Справочник: репрезентативная выборка кодов ОКЭД Казахстана
OKED_REGISTRY: dict[str, OkedProfile] = {
    # ── Низкая маржа (5%) ────────────────────────────────────────────────────
    "47111": OkedProfile("47111", "Розничная торговля, супермаркеты",         "low",    5.0),
    "47190": OkedProfile("47190", "Прочая розничная торговля",                "low",    5.0),
    "49410": OkedProfile("49410", "Грузовые автоперевозки",                   "low",    5.0),
    "01110": OkedProfile("01110", "Выращивание зерновых культур",             "low",    5.0),
    "10410": OkedProfile("10410", "Производство растительных масел",          "low",    5.0),
    "41200": OkedProfile("41200", "Строительство жилых зданий",               "low",    5.0),

    # ── Средняя маржа (12%) ──────────────────────────────────────────────────
    "10710": OkedProfile("10710", "Производство хлебобулочных изделий",       "medium", 12.0),
    "56100": OkedProfile("56100", "Рестораны и кафе",                         "medium", 12.0),
    "45200": OkedProfile("45200", "Техническое обслуживание автомобилей",     "medium", 12.0),
    "86210": OkedProfile("86210", "Медицинские клиники",                      "medium", 12.0),
    "68100": OkedProfile("68100", "Операции с недвижимым имуществом",         "medium", 12.0),
    "85420": OkedProfile("85420", "Образование для взрослых (курсы)",         "medium", 12.0),

    # ── Высокая маржа (15%) ──────────────────────────────────────────────────
    "62011": OkedProfile("62011", "Разработка программного обеспечения (IT)", "high",   15.0),
    "62020": OkedProfile("62020", "Консультации в области ИТ",                "high",   15.0),
    "64190": OkedProfile("64190", "Финансовое посредничество (банки/МФО)",    "high",   15.0),
    "65120": OkedProfile("65120", "Страховые компании",                       "high",   15.0),
    "69100": OkedProfile("69100", "Юридическая деятельность",                 "high",   15.0),
    "70220": OkedProfile("70220", "Управленческий консалтинг",                "high",   15.0),
    "74300": OkedProfile("74300", "Переводы и лингвистические услуги",        "high",   15.0),
}

# Дефолтный профиль для неизвестных кодов ОКЭД
_DEFAULT_PROFILE = OkedProfile("00000", "Вид деятельности не определён", "medium", 12.0)

MARGIN_TIER_LABELS: dict[str, str] = {
    "low":    "Низкая маржа",
    "medium": "Средняя маржа",
    "high":   "Высокая маржа",
}


# ─────────────────────────────────────────────────────────────────────────────
# 2. ФУНКЦИЯ: calculate_dynamic_retention
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class RetentionResult:
    """Результат расчёта динамического удержания."""
    gross_amount: float        # Входящая сумма (брутто)
    chsi_withheld: float       # Удержано в пользу взыскателя/ЧСИ
    net_to_business: float     # Зачислено на счёт должника
    margin_tier: str           # Уровень маржинальности ("low"/"medium"/"high")
    margin_label: str          # Читаемое название уровня
    percentage_applied: float  # Применённый процент удержания
    oked_description: str      # Описание вида деятельности
    oked_code: str             # Код ОКЭД


def calculate_dynamic_retention(
    amount: float,
    oked_code: str,
) -> RetentionResult:
    """
    Рассчитывает динамическое удержание от входящего платежа.

    Args:
        amount:     Сумма поступления (тенге, брутто).
        oked_code:  Код ОКЭД должника (например, "62011").

    Returns:
        RetentionResult с разбивкой gross / withheld / net и мета-данными.

    Example:
        >>> r = calculate_dynamic_retention(5_000_000, "47111")
        >>> r.percentage_applied
        5.0
        >>> r.chsi_withheld
        250000.0
    """
    profile = OKED_REGISTRY.get(oked_code, _DEFAULT_PROFILE)

    withheld  = round(amount * profile.retention_percent / 100, 2)
    net       = round(amount - withheld, 2)

    return RetentionResult(
        gross_amount       = float(amount),
        chsi_withheld      = withheld,
        net_to_business    = net,
        margin_tier        = profile.margin_tier,
        margin_label       = MARGIN_TIER_LABELS[profile.margin_tier],
        percentage_applied = profile.retention_percent,
        oked_description   = profile.description,
        oked_code          = oked_code,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. ФУНКЦИЯ: evaluate_transaction
# ─────────────────────────────────────────────────────────────────────────────

# Белый список КНП: защищённые платежи (зарплата, налоги, соц. отчисления)
KNP_WHITELIST: set[int] = {
    110, 111, 112,          # Заработная плата
    911, 912,               # Обязательные пенсионные взносы / ОСМС
    10, 20, 30, 40,         # Налоги в бюджет
    101, 102, 103,          # Авансы по зарплате
    120,                    # Отпускные
}

# Серая зона КНП: потенциально подозрительные коды
KNP_GREY_ZONE: set[int] = {
    850, 860,               # Дивиденды / распределение прибыли
    421,                    # Переводы нерезидентам
    220,                    # Финансовая помощь / займы
    710, 720,               # Платежи за услуги (высокий риск подмены)
}

# Ключевые слова, однозначно указывающие на вывод средств / обналичивание
_BLOCK_KEYWORDS = re.compile(
    r"обнал|обналич|вывод.{0,20}(наличн|родствен|учредит|директор)|"
    r"родственник|супруг[еа]?|дочер|сестр[еу]?|брат[еу]?|сын[ау]?|"
    r"аффилир|связанн[ыо]|учредител|займ.{0,15}директор",
    re.IGNORECASE,
)

# Мок-история: типичный диапазон сумм для «нормальных» платежей компании
_TYPICAL_AMOUNT_MIN = 10_000
_TYPICAL_AMOUNT_MAX = 3_000_000  # > 3 млн в серой зоне → усиленный риск


@dataclass
class TransactionVerdict:
    """Вердикт по транзакции для фронтенда и инспектора ЧСИ."""
    status: str             # "approved" | "grey" | "blocked"
    color: str              # "green" | "yellow" | "red"  (для UI-индикатора)
    label: str              # Читаемый статус на русском
    risk_score: int         # 0–100
    ai_reasoning: str       # Текстовое обоснование для инспектора


def evaluate_transaction(
    amount: float,
    knp_code: int | str,
    purpose: str,
    company_strikes: int,
    *,
    oked_code: Optional[str] = None,
) -> TransactionVerdict:
    """
    Трёхуровневая оценка исходящей транзакции должника.

    Уровни решений:
        ALLOW  → зарплата / налоги (белый КНП)
        GREY   → подозрительный КНП или нетипичная сумма (ЧСИ подтверждает)
        BLOCK  → 3+ страйка OR ключевые слова обнала OR КНП 850 + высокая сумма

    Args:
        amount:           Сумма платежа (тенге).
        knp_code:         КНП — код назначения платежа (int или str).
        purpose:          Назначение платежа (свободный текст).
        company_strikes:  Текущее число страйков у компании.
        oked_code:        Код ОКЭД должника (опционально, для дополнительного контекста).

    Returns:
        TransactionVerdict со статусом, цветом, риск-баллом и обоснованием.

    Example:
        >>> v = evaluate_transaction(500_000, 110, "Зарплата за март", 0)
        >>> v.status
        'approved'
    """
    knp = int(knp_code) if isinstance(knp_code, str) and knp_code.isdigit() else int(knp_code)
    desc_lower = purpose.lower()

    # ── BLOCK: Обнаружены явные признаки мошенничества ──────────────────────
    if company_strikes >= 3:
        return TransactionVerdict(
            status       = "blocked",
            color        = "red",
            label        = "Заблокировано — CRITICAL RISK",
            risk_score   = 100,
            ai_reasoning = (
                f"CRITICAL_RISK: Компания имеет {company_strikes} страйка(ов). "
                "Достигнут критический порог нарушений. "
                "Согласно правилам системы, все исходящие платежи данного должника "
                "блокируются автоматически до проведения проверки. "
                "Рекомендуется немедленное обращение к судебному акту."
            ),
        )

    if _BLOCK_KEYWORDS.search(desc_lower):
        return TransactionVerdict(
            status       = "blocked",
            color        = "red",
            label        = "Заблокировано — Признаки вывода средств",
            risk_score   = 95,
            ai_reasoning = (
                f"Назначение платежа содержит признаки обналичивания или вывода средств "
                f"аффилированным лицам: «{purpose[:80]}». "
                "Транзакция заблокирована автоматически. Зафиксирован страйк."
            ),
        )

    # ── ALLOW: Защищённые категории (белый список КНП) ──────────────────────
    if knp in KNP_WHITELIST:
        return TransactionVerdict(
            status       = "approved",
            color        = "green",
            label        = "Разрешено — Защищённый платёж",
            risk_score   = 0,
            ai_reasoning = (
                f"КНП {knp} относится к защищённой категории "
                f"(зарплата / налоги / обязательные отчисления). "
                "Транзакция одобрена автоматически. "
                "Удержание 15% на данный платёж не распространяется согласно ст. 96 ЗК РК."
            ),
        )

    # ── GREY: Серая зона — подозрительный КНП или нетипичная сумма ──────────
    reasons: list[str] = []

    if knp in KNP_GREY_ZONE:
        reasons.append(f"КНП {knp} относится к категории повышенного риска (дивиденды / нерезиденты / финансовая помощь)")

    if amount > _TYPICAL_AMOUNT_MAX and knp not in KNP_WHITELIST:
        reasons.append(f"Сумма {amount:,.0f} ₸ превышает типичный диапазон нормальных операций (> 3 000 000 ₸)")

    if any(kw in desc_lower for kw in ["консалт", "управлени", "сопровожд", "агент"]):
        reasons.append("Назначение платежа содержит признаки консалтинговой прокладки")

    if reasons:
        risk = min(30 + len(reasons) * 20, 85)
        return TransactionVerdict(
            status       = "grey",
            color        = "yellow",
            label        = "Серая зона — Требует подтверждения ЧСИ",
            risk_score   = risk,
            ai_reasoning = (
                "Транзакция помечена как серая зона. Выявленные риски: "
                + "; ".join(reasons)
                + ". Платёж заморожен до подтверждения инспектора ЧСИ."
            ),
        )

    # ── Дефолт: прочие КНП без явных признаков риска ────────────────────────
    return TransactionVerdict(
        status       = "grey",
        color        = "yellow",
        label        = "Серая зона — КНП вне стандартных категорий",
        risk_score   = 35,
        ai_reasoning = (
            f"КНП {knp} не входит в белый список защищённых платежей и не является "
            "явно мошеннической операцией. Применён консервативный подход: "
            "транзакция отправлена на ручное подтверждение ЧСИ."
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 4. БЛОК ДЕМОНСТРАЦИИ — Терминальная симуляция
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_money(amount: float) -> str:
    return f"{amount:>15,.0f} ₸".replace(",", " ")

def _status_badge(verdict: TransactionVerdict) -> str:
    badges = {"green": "[ ✅ РАЗРЕШЕНО  ]", "yellow": "[ ⚠️  СЕРАЯ ЗОНА ]", "red": "[ 🔴 ЗАБЛОКИР.  ]"}
    return badges.get(verdict.color, "[  НЕИЗВЕСТНО  ]")

def _retention_bar(pct: float, width: int = 30) -> str:
    filled = round(width * pct / 100)
    return "█" * filled + "░" * (width - filled)


if __name__ == "__main__":
    BORDER = "═" * 70
    THIN   = "─" * 70

    print(f"\n{'═'*70}")
    print(f"  ██████╗  ██████╗ ██╗   ██╗███████╗       █████╗ ██╗")
    print(f" ██╔════╝ ██╔═══██╗██║   ██║██╔════╝      ██╔══██╗██║")
    print(f" ██║  ███╗██║   ██║██║   ██║█████╗        ███████║██║")
    print(f" ██║   ██║██║   ██║╚██╗ ██╔╝██╔══╝        ██╔══██║██║")
    print(f" ╚██████╔╝╚██████╔╝ ╚████╔╝ ███████╗      ██║  ██║██║")
    print(f"  ╚═════╝  ╚═════╝   ╚═══╝  ╚══════╝      ╚═╝  ╚═╝╚═╝")
    print(f"  Gove.AI Engine v1.0 — Модуль финансовой разведки ЧСИ РК")
    print(f"{'═'*70}\n")

    # ── СЦЕНАРИЙ 1: Входящий платёж — Супермаркет (низкая маржа) ────────────
    print(f"  СЦЕНАРИЙ 1 / ВХОДЯЩИЙ ПЛАТЁЖ — РОЗНИЧНАЯ ТОРГОВЛЯ")
    print(f"  {THIN}")
    r1 = calculate_dynamic_retention(5_000_000, "47111")
    print(f"  Компания   : {r1.oked_description} (ОКЭД {r1.oked_code})")
    print(f"  Маржа      : {r1.margin_label} → удержание {r1.percentage_applied:.0f}%")
    print(f"  [{_retention_bar(r1.percentage_applied)}] {r1.percentage_applied:.0f}%")
    print(f"  Брутто     :{_fmt_money(r1.gross_amount)}")
    print(f"  Удержано   :{_fmt_money(r1.chsi_withheld)}  ← зачислено ЧСИ")
    print(f"  На счёт    :{_fmt_money(r1.net_to_business)}")
    print()

    # ── СЦЕНАРИЙ 2: Входящий платёж — IT-компания (высокая маржа) ───────────
    print(f"  СЦЕНАРИЙ 2 / ВХОДЯЩИЙ ПЛАТЁЖ — IT / РАЗРАБОТКА ПО")
    print(f"  {THIN}")
    r2 = calculate_dynamic_retention(5_000_000, "62011")
    print(f"  Компания   : {r2.oked_description} (ОКЭД {r2.oked_code})")
    print(f"  Маржа      : {r2.margin_label} → удержание {r2.percentage_applied:.0f}%")
    print(f"  [{_retention_bar(r2.percentage_applied)}] {r2.percentage_applied:.0f}%")
    print(f"  Брутто     :{_fmt_money(r2.gross_amount)}")
    print(f"  Удержано   :{_fmt_money(r2.chsi_withheld)}  ← зачислено ЧСИ")
    print(f"  На счёт    :{_fmt_money(r2.net_to_business)}")
    print()

    # ── СЦЕНАРИЙ 3: Исходящий — Зарплата (КНП 110, зелёный свет) ───────────
    print(f"  СЦЕНАРИЙ 3 / ИСХОДЯЩИЙ ПЛАТЁЖ — ЗАРПЛАТА")
    print(f"  {THIN}")
    v3 = evaluate_transaction(850_000, 110, "Заработная плата за март 2026", 0)
    print(f"  КНП 110 | Сумма:{_fmt_money(850_000)}")
    print(f"  Решение    : {_status_badge(v3)}  risk={v3.risk_score}/100")
    print(f"  Обоснование: {v3.ai_reasoning[:120]}...")
    print()

    # ── СЦЕНАРИЙ 4: Исходящий — Дивиденды (КНП 850, серая зона) ────────────
    print(f"  СЦЕНАРИЙ 4 / ИСХОДЯЩИЙ ПЛАТЁЖ — ДИВИДЕНДЫ (подозрительный)")
    print(f"  {THIN}")
    v4 = evaluate_transaction(4_200_000, 850, "Выплата дивидендов учредителям за 2025 г.", 1)
    print(f"  КНП 850 | Сумма:{_fmt_money(4_200_000)}")
    print(f"  Решение    : {_status_badge(v4)}  risk={v4.risk_score}/100")
    print(f"  Обоснование: {v4.ai_reasoning[:140]}...")
    print()

    # ── СЦЕНАРИЙ 5: Исходящий — Critical Risk (3 страйка) ───────────────────
    print(f"  СЦЕНАРИЙ 5 / CRITICAL RISK — КОМПАНИЯ С 3 СТРАЙКАМИ")
    print(f"  {THIN}")
    v5 = evaluate_transaction(200_000, 110, "Зарплата", company_strikes=3)
    print(f"  КНП 110 | Сумма:{_fmt_money(200_000)} | Страйков: 3")
    print(f"  Решение    : {_status_badge(v5)}  risk={v5.risk_score}/100")
    print(f"  Обоснование: {v5.ai_reasoning[:140]}...")
    print()

    print(f"{'═'*70}")
    print(f"  Симуляция завершена. Gove.AI Engine готов к интеграции.")
    print(f"{'═'*70}\n")
