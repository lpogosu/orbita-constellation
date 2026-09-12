"""Экономическая модель ОРБИТЫ: считает все таблицы `docs/13_ECONOMICS.md` из `params.json`.

Запуск: `python docs/economics/model.py`. Только стандартная библиотека, Python 3.11+.

Ни одно число не зашито в код: любое входное значение лежит в `params.json` с пометкой
`[И]` (источник и URL) или `[Д]` (допущение и его обоснование). Меняется параметр —
пересчитываются все таблицы, поэтому документ и модель не могут разойтись.
"""

from __future__ import annotations

import io
import json
import sys
from dataclasses import dataclass
from pathlib import Path

PARAMS_PATH = Path(__file__).with_name("params.json")

SCENARIOS = ("conservative", "base", "optimistic")
PHASES = ("pilot", "production")


# --- чтение JSON без `Any`: узлы разбираются явными аксессорами -----------------------


def as_dict(node: dict[str, object], key: str) -> dict[str, object]:
    """Возвращает вложенный объект, иначе сообщает, какой ключ испорчен."""
    value = node.get(key)
    if not isinstance(value, dict):
        raise TypeError(f"params.json: ключ {key!r} должен быть объектом")
    return {str(k): v for k, v in value.items()}


def as_rows(node: dict[str, object], key: str) -> list[dict[str, object]]:
    """Возвращает список объектов (строки таблиц: инфраструктура, лицензии, процесс)."""
    value = node.get(key)
    if not isinstance(value, list):
        raise TypeError(f"params.json: ключ {key!r} должен быть списком")
    rows: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            raise TypeError(f"params.json: элементы {key!r} должны быть объектами")
        rows.append({str(k): v for k, v in item.items()})
    return rows


def as_float(node: dict[str, object], key: str) -> float:
    """Возвращает число; `True`/`False` числом не считаются."""
    value = node.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError(f"params.json: ключ {key!r} должен быть числом")
    return float(value)


def as_str(node: dict[str, object], key: str) -> str:
    """Возвращает строку."""
    value = node.get(key)
    if not isinstance(value, str):
        raise TypeError(f"params.json: ключ {key!r} должен быть строкой")
    return value


@dataclass(frozen=True)
class Cited:
    """Значение вместе с его происхождением. `note` начинается с `[И]` или `[Д]`."""

    value: float
    unit: str
    note: str
    url: str
    date: str

    @property
    def origin(self) -> str:
        """Короткая пометка происхождения для колонки «Источник»."""
        suffix = f" ({self.date})" if self.date else ""
        link = f" {self.url}" if self.url else ""
        return f"{self.note}{link}{suffix}"


def read_cited(node: dict[str, object], key: str) -> Cited:
    """Разбирает узел вида `{value, unit, source|assumption, url, date}`."""
    raw = as_dict(node, key)
    if "source" in raw:
        note = f"[И] {as_str(raw, 'source')}"
    elif "assumption" in raw:
        note = f"[Д] {as_str(raw, 'assumption')}"
    else:
        raise TypeError(f"params.json: {key!r} без поля source или assumption")
    return Cited(
        value=as_float(raw, "value"),
        unit=as_str(raw, "unit"),
        note=note,
        url=str(raw.get("url", "")),
        date=str(raw.get("date", "")),
    )


# --- форматирование ------------------------------------------------------------------


def money(value: float) -> str:
    """Рубли без копеек, разряды разделены неразрывным пробелом."""
    return f"{round(value):,}".replace(",", " ")


def number(value: float, digits: int = 1) -> str:
    """Число с запятой как десятичным разделителем и без хвостовых нулей."""
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return (text or "0").replace(".", ",")


def table(headers: list[str], rows: list[list[str]], right: set[int]) -> str:
    """Markdown-таблица; индексы из `right` выравниваются вправо."""
    separator = ["---:" if i in right else "---" for i in range(len(headers))]
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(separator) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


# --- модель --------------------------------------------------------------------------


@dataclass(frozen=True)
class Model:
    """Все расчёты документа. Держит разобранный `params.json` и ничего не кэширует."""

    raw: dict[str, object]

    @property
    def payroll(self) -> dict[str, object]:
        """Блок ставок взносов, накладных и норм рабочего времени."""
        return as_dict(self.raw, "payroll")

    def scenario(self, name: str) -> dict[str, object]:
        """Блок одного сценария."""
        return as_dict(as_dict(self.raw, "scenarios"), name)

    # ставки -------------------------------------------------------------------------

    def role_titles(self) -> dict[str, str]:
        """Человеческое название каждой роли."""
        roles = as_dict(self.raw, "roles")
        return {key: as_str(as_dict(roles, key), "title") for key in roles}

    def salary(self, role: str) -> Cited:
        """Оклад роли gross, руб./мес."""
        return read_cited(as_dict(as_dict(self.raw, "roles"), role), "salary")

    def contributions_monthly(self, role: str) -> float:
        """Страховые взносы на роль, руб./мес.

        С 2026 года льгота аккредитованных ИТ-компаний перестала быть плоской: до
        предельной базы ставка одна, сверх базы — другая (ФЗ № 425-ФЗ). База считается
        нарастающим итогом за год, поэтому эффективная ставка зависит от оклада, и
        плоский процент здесь дал бы заметную ошибку на senior-окладах.
        """
        annual = self.salary(role).value * 12.0
        limit = read_cited(self.payroll, "insurance_base_limit").value
        within = read_cited(self.payroll, "insurance_it_within_base").value
        above = read_cited(self.payroll, "insurance_it_above_base").value
        injuries = read_cited(self.payroll, "injury").value
        contributions = min(annual, limit) * within + max(0.0, annual - limit) * above
        return contributions / 12.0 + self.salary(role).value * injuries

    def overhead_monthly(self, role: str) -> float:
        """Накладные расходы на роль, руб./мес."""
        overhead = read_cited(self.payroll, "overhead").value
        return (self.salary(role).value + self.contributions_monthly(role)) * overhead

    def loaded_monthly(self, role: str) -> float:
        """Полная стоимость роли для компании: оклад + взносы + накладные."""
        return (
            self.salary(role).value
            + self.contributions_monthly(role)
            + self.overhead_monthly(role)
        )

    def engineer_hour_rate(self) -> float:
        """Полная стоимость часа доменного инженера — цена его сэкономленного времени."""
        hours = read_cited(self.payroll, "work_hours_per_month").value
        return self.loaded_monthly("domain") / hours

    # команда и сроки ------------------------------------------------------------------

    def team(self, phase: str) -> dict[str, object]:
        """Состав команды разработки фазы: роль → `{fte, months}`."""
        return as_dict(as_dict(self.raw, "team"), phase)

    def duration_factor(self, name: str) -> float:
        """Множитель календарного срока сценария к плановому."""
        return read_cited(self.scenario(name), "duration_factor").value

    def phase_months(self, phase: str, name: str) -> float:
        """Календарный срок фазы с учётом сценария."""
        planned = read_cited(as_dict(self.raw, "phase_months"), phase).value
        return planned * self.duration_factor(name)

    def phase_fte(self, phase: str) -> float:
        """Суммарная загрузка команды фазы в FTE."""
        team = self.team(phase)
        return sum(as_float(as_dict(team, role), "fte") for role in team)

    def role_cost(self, phase: str, role: str, name: str) -> float:
        """Стоимость одной роли на фазе: FTE × месяцы × полная ставка."""
        entry = as_dict(self.team(phase), role)
        months = as_float(entry, "months") * self.duration_factor(name)
        return as_float(entry, "fte") * months * self.loaded_monthly(role)

    def dev_cost(self, phase: str, name: str) -> float:
        """Стоимость разработки фазы."""
        return sum(self.role_cost(phase, role, name) for role in self.team(phase))

    def investment(self, name: str) -> float:
        """Вложение, которое окупается: разработка пилота плюс инфраструктура за срок."""
        months = self.phase_months("pilot", name)
        return self.dev_cost("pilot", name) + self.infra_monthly("pilot") * months

    # эксплуатация ---------------------------------------------------------------------

    def ops_team(self, kind: str) -> dict[str, object]:
        """Состав эксплуатации: роль → `{fte}`."""
        return as_dict(as_dict(self.raw, "ops"), kind)

    def ops_fte(self, kind: str) -> float:
        """Суммарный FTE эксплуатации."""
        team = self.ops_team(kind)
        return sum(as_float(as_dict(team, role), "fte") for role in team)

    def ops_annual(self, kind: str) -> float:
        """Годовая стоимость эксплуатации по ролям."""
        team = self.ops_team(kind)
        return sum(
            as_float(as_dict(team, role), "fte") * 12.0 * self.loaded_monthly(role)
            for role in team
        )

    # инфраструктура -------------------------------------------------------------------

    def infra_rows(self) -> list[dict[str, object]]:
        """Позиции инфраструктуры с ценой для каждого масштаба."""
        return as_rows(self.raw, "infrastructure")

    def infra_monthly(self, scale: str) -> float:
        """Инфраструктура в месяц для масштаба `pilot`, `production` или `onprem`."""
        return sum(as_float(row, scale) for row in self.infra_rows())

    # процесс инженера -----------------------------------------------------------------

    def process_rows(self) -> list[dict[str, object]]:
        """Шаги перебора одной конфигурации сегодня и в ОРБИТЕ."""
        return as_rows(self.raw, "process")

    def hours_before(self) -> float:
        """Часы инженера на один вариант сегодня."""
        return sum(as_float(row, "hours_before") for row in self.process_rows())

    def hours_after(self) -> float:
        """Часы инженера на один вариант в ОРБИТЕ."""
        return sum(as_float(row, "hours_after") for row in self.process_rows())

    def hours_saved_per_variant(self, name: str) -> float:
        """Экономия на вариант с поправкой на долю реально реализуемой выгоды."""
        realization = read_cited(self.scenario(name), "savings_realization").value
        return (self.hours_before() - self.hours_after()) * realization

    def variants_per_year(self, name: str) -> float:
        """Число проработанных вариантов в год."""
        scenario = self.scenario(name)
        projects = read_cited(scenario, "projects_per_year").value
        per_project = read_cited(scenario, "variants_per_project").value
        return projects * per_project

    def hours_saved_per_year(self, name: str) -> float:
        """Годовая экономия часов доменного инженера."""
        return self.variants_per_year(name) * self.hours_saved_per_variant(name)

    # итоги ----------------------------------------------------------------------------

    def annual_benefit(self, name: str) -> float:
        """Годовая выгода: сэкономленные часы плюс предотвращённая поздняя переработка."""
        rework = read_cited(self.scenario(name), "avoided_rework_per_year").value
        return self.hours_saved_per_year(name) * self.engineer_hour_rate() + rework

    def annual_cost(self, name: str) -> float:
        """Годовая стоимость владения: инфраструктура и поддержка."""
        scale = as_str(self.scenario(name), "infra_scale")
        ops = as_str(self.scenario(name), "ops_team")
        return self.infra_monthly(scale) * 12.0 + self.ops_annual(ops)

    def net_annual(self, name: str) -> float:
        """Чистый годовой эффект."""
        return self.annual_benefit(name) - self.annual_cost(name)

    def payback_months(self, name: str) -> float | None:
        """Срок окупаемости вложения, месяцы. `None`, если эффект неположительный."""
        net = self.net_annual(name)
        if net <= 0.0:
            return None
        return self.investment(name) / (net / 12.0)

    def roi(self, name: str) -> float:
        """ROI первого года эксплуатации по формуле `09_DEMO_ECONOMICS.md` §3."""
        return self.net_annual(name) / self.annual_cost(name)

    # чувствительность -------------------------------------------------------------------

    def payback_with(self, name: str, key: str, value: float) -> float | None:
        """Payback при подмене одного параметра сценария."""
        raw = json.loads(json.dumps(self.raw))
        raw["scenarios"][name][key]["value"] = value
        return Model(raw).payback_months(name)


# --- таблицы документа ----------------------------------------------------------------


def rates_table(model: Model) -> str:
    """Т1. Полная стоимость роли для работодателя."""
    rows: list[list[str]] = []
    for role, title in model.role_titles().items():
        salary = model.salary(role)
        contributions = model.contributions_monthly(role)
        rows.append(
            [
                title,
                money(salary.value),
                money(contributions),
                f"{number(contributions / salary.value * 100.0)} %",
                money(model.overhead_monthly(role)),
                money(model.loaded_monthly(role)),
                salary.origin,
            ]
        )
    headers = [
        "Роль",
        "Оклад gross",
        "Взносы",
        "эфф. ставка",
        "Накладные",
        "Полная ставка",
        "Источник оклада",
    ]
    return table(headers, rows, right={1, 2, 3, 4, 5})


def team_table(model: Model) -> str:
    """Т2. Команда разработки: pilot и production."""
    titles = model.role_titles()
    rows: list[list[str]] = []
    for role in titles:
        cells = [titles[role]]
        for phase in PHASES:
            team = model.team(phase)
            if role in team:
                entry = as_dict(team, role)
                cells += [number(as_float(entry, "fte"), 2), number(as_float(entry, "months"))]
            else:
                cells += ["—", "—"]
        rows.append(cells)
    totals = ["**Итого**"]
    for phase in PHASES:
        totals += [f"**{number(model.phase_fte(phase), 2)}**", ""]
    rows.append(totals)
    headers = ["Роль", "FTE pilot", "мес. pilot", "FTE production", "мес. production"]
    return table(headers, rows, right={1, 2, 3, 4})


def ops_table(model: Model) -> str:
    """Т3. Эксплуатация: FTE и годовая стоимость."""
    titles = model.role_titles()
    rows: list[list[str]] = []
    for role in titles:
        cells = [titles[role]]
        for kind in PHASES:
            team = model.ops_team(kind)
            cells.append(
                number(as_float(as_dict(team, role), "fte"), 2) if role in team else "—"
            )
        rows.append(cells)
    rows.append(
        [
            "**Итого FTE**",
            f"**{number(model.ops_fte('pilot'), 2)}**",
            f"**{number(model.ops_fte('production'), 2)}**",
        ]
    )
    rows.append(
        [
            "**Стоимость, ₽/год**",
            f"**{money(model.ops_annual('pilot'))}**",
            f"**{money(model.ops_annual('production'))}**",
        ]
    )
    return table(["Роль", "pilot", "production"], rows, right={1, 2})


def duration_table(model: Model) -> str:
    """Т4. Календарный срок и стоимость разработки по сценариям."""
    rows: list[list[str]] = []
    for phase in PHASES:
        label = "pilot" if phase == "pilot" else "production"
        rows.append(
            [f"Срок {label}, мес."]
            + [number(model.phase_months(phase, name)) for name in SCENARIOS]
        )
        rows.append(
            [f"Разработка {label}, ₽"] + [money(model.dev_cost(phase, name)) for name in SCENARIOS]
        )
    rows.append(
        ["Вложение к окупаемости, ₽"] + [money(model.investment(name)) for name in SCENARIOS]
    )
    return table(["Показатель", *SCENARIOS], rows, right={1, 2, 3})


def infra_table(model: Model) -> str:
    """Т5. Инфраструктура в месяц по трём масштабам."""
    rows: list[list[str]] = []
    for row in model.infra_rows():
        rows.append(
            [
                as_str(row, "item"),
                as_str(row, "config"),
                money(as_float(row, "pilot")),
                money(as_float(row, "production")),
                money(as_float(row, "onprem")),
                str(row.get("note", "")),
            ]
        )
    rows.append(
        [
            "**Итого, ₽/мес**",
            "",
            f"**{money(model.infra_monthly('pilot'))}**",
            f"**{money(model.infra_monthly('production'))}**",
            f"**{money(model.infra_monthly('onprem'))}**",
            "",
        ]
    )
    headers = ["Позиция", "Конфигурация", "pilot", "production", "on-premise", "Источник"]
    return table(headers, rows, right={2, 3, 4})


def license_table(model: Model) -> str:
    """Т6. Лицензии компонентов."""
    rows = [
        [
            as_str(row, "component"),
            as_str(row, "license"),
            as_str(row, "verdict"),
            str(row.get("note", "")),
        ]
        for row in as_rows(model.raw, "licenses")
    ]
    return table(["Компонент", "Лицензия", "Годен для production", "Источник"], rows, right=set())


def process_table(model: Model) -> str:
    """Т7. Один вариант конфигурации: часы инженера сегодня и в ОРБИТЕ."""
    rows: list[list[str]] = []
    for row in model.process_rows():
        before = as_float(row, "hours_before")
        after = as_float(row, "hours_after")
        rows.append(
            [
                as_str(row, "step"),
                number(before, 2),
                number(after, 2),
                number(before - after, 2),
                str(row.get("note", "")),
            ]
        )
    rows.append(
        [
            "**Итого на вариант, ч**",
            f"**{number(model.hours_before(), 2)}**",
            f"**{number(model.hours_after(), 2)}**",
            f"**{number(model.hours_before() - model.hours_after(), 2)}**",
            "",
        ]
    )
    headers = ["Шаг перебора одной конфигурации", "Сегодня, ч", "ОРБИТА, ч", "Δ, ч", "Источник"]
    return table(headers, rows, right={1, 2, 3})


def economics_table(model: Model) -> str:
    """Т8. Главная таблица: три сценария, payback и ROI."""
    rows: list[list[str]] = []

    def line(title: str, render: str) -> None:
        rows.append([title, *[render_value(model, name, render) for name in SCENARIOS]])

    line("Проектов в год", "projects")
    line("Вариантов на проект", "variants")
    line("Вариантов в год", "variants_year")
    line("Доля реализуемой экономии", "realization")
    line("Экономия на вариант, ч", "hours_variant")
    line("Экономия в год, ч инженера", "hours_year")
    line("Стоимость часа инженера, ₽", "hour_rate")
    line("Годовая выгода, ₽", "benefit")
    line("Годовая стоимость владения, ₽", "annual_cost")
    line("Чистый годовой эффект, ₽", "net")
    line("Вложение, ₽", "investment")
    line("**Payback, мес.**", "payback")
    line("**ROI первого года**", "roi")
    return table(["Показатель", *SCENARIOS], rows, right={1, 2, 3})


def render_value(model: Model, name: str, kind: str) -> str:
    """Одно значение главной таблицы."""
    scenario = model.scenario(name)
    if kind == "projects":
        return number(read_cited(scenario, "projects_per_year").value)
    if kind == "variants":
        return number(read_cited(scenario, "variants_per_project").value)
    if kind == "variants_year":
        return number(model.variants_per_year(name))
    if kind == "realization":
        return number(read_cited(scenario, "savings_realization").value, 2)
    if kind == "hours_variant":
        return number(model.hours_saved_per_variant(name), 2)
    if kind == "hours_year":
        return money(model.hours_saved_per_year(name))
    if kind == "hour_rate":
        return money(model.engineer_hour_rate())
    if kind == "benefit":
        return money(model.annual_benefit(name))
    if kind == "annual_cost":
        return money(model.annual_cost(name))
    if kind == "net":
        return money(model.net_annual(name))
    if kind == "investment":
        return money(model.investment(name))
    if kind == "payback":
        payback = model.payback_months(name)
        return f"**{number(payback)}**" if payback is not None else "**не окупается**"
    if kind == "roi":
        return f"**{number(model.roi(name) * 100.0)} %**"
    raise ValueError(f"неизвестная строка таблицы: {kind}")


def sensitivity_table(model: Model, name: str = "base") -> str:
    """Т9. Чувствительность payback к параметрам, которые двигают его сильнее всего."""
    rows: list[list[str]] = []
    for row in as_rows(model.raw, "sensitivity"):
        key = as_str(row, "param")
        low = as_float(row, "low")
        high = as_float(row, "high")
        base = read_cited(model.scenario(name), key).value
        payback_low = model.payback_with(name, key, low)
        payback_high = model.payback_with(name, key, high)
        rows.append(
            [
                as_str(row, "title"),
                number(low, 2),
                number(base, 2),
                number(high, 2),
                format_payback(payback_low),
                format_payback(payback_high),
                str(row.get("note", "")),
            ]
        )
    rows.sort(key=sensitivity_sort_key, reverse=True)
    headers = [
        "Параметр",
        "низкое",
        "base",
        "высокое",
        "Payback при низком, мес.",
        "Payback при высоком, мес.",
        "Комментарий",
    ]
    return table(headers, rows, right={1, 2, 3, 4, 5})


def sensitivity_sort_key(row: list[str]) -> float:
    """Размах payback между границами — чем больше, тем выше строка в таблице."""
    values = [parse_number(row[4]), parse_number(row[5])]
    known = [value for value in values if value is not None]
    if len(known) < 2:
        return float("inf")
    return abs(known[0] - known[1])


def parse_number(text: str) -> float | None:
    """Обратное преобразование к `number` для сортировки таблицы чувствительности."""
    try:
        return float(text.replace(" ", "").replace(",", "."))
    except ValueError:
        return None


def format_payback(value: float | None) -> str:
    """Payback или явная отметка, что при таком параметре вложение не возвращается."""
    return number(value) if value is not None else "не окупается"


def load_model(path: Path = PARAMS_PATH) -> Model:
    """Читает `params.json`."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise TypeError("params.json: в корне должен быть объект")
    return Model({str(k): v for k, v in raw.items()})


def main() -> None:
    """Печатает все таблицы документа в порядке его разделов."""
    # Консоль Windows по умолчанию в cp1251 и не кодирует «₽»; вывод всегда UTF-8,
    # чтобы таблицы можно было перенаправить в файл на любой машине.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    model = load_model()
    blocks = [
        ("Т1. Полная стоимость роли для работодателя, ₽/мес", rates_table(model)),
        ("Т2. Команда разработки", team_table(model)),
        ("Т3. Эксплуатация", ops_table(model)),
        ("Т4. Сроки и стоимость разработки", duration_table(model)),
        ("Т5. Инфраструктура, ₽/мес", infra_table(model)),
        ("Т6. Лицензии", license_table(model)),
        ("Т7. Процесс инженера на один вариант", process_table(model)),
        ("Т8. Экономика: три сценария", economics_table(model)),
        ("Т9. Чувствительность payback (base)", sensitivity_table(model)),
    ]
    for title, body in blocks:
        print(f"### {title}\n")
        print(body)
        print()


if __name__ == "__main__":
    main()
