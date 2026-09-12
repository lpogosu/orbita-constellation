"""Проверка сценария ядром и производные от него величины.

HTTP-слой не повторяет ни одного правила `01_SPEC.md` §3.1: pydantic отвечает за типы и
обязательность полей, всё остальное — диапазоны, уникальность идентификаторов, разрешение
ссылок, кратность сетки, интервалы недоступности — проверяет `orbita_core.scenario`.
"""

import hashlib
from typing import Any

from orbita_core import scenario as core

from orbita_api.error_handling import ScenarioRejectedError
from orbita_api.schemas.errors import ErrorCode, ErrorDetail
from orbita_api.schemas.scenario import Scenario, ScenarioValidationResult


def parse(scenario: Scenario) -> core.Scenario:
    """Канонизирует сценарий ядром либо отвергает его со всеми найденными ошибками."""
    try:
        return core.parse(scenario.model_dump(mode="json"))
    except core.ScenarioError as error:
        raise ScenarioRejectedError([_to_error_detail(issue) for issue in error.errors]) from error


def _to_error_detail(issue: core.ScenarioIssue) -> ErrorDetail:
    """Ошибка ядра в конверт `05_API.md` §3.

    Коды ядра и API — одни и те же строки глоссария §3.6, поэтому код переносится как
    есть. Пустой путь ядра означает «ошибка не о поле» и превращается в `null`.
    """
    return ErrorDetail(
        code=ErrorCode(str(issue.code)),
        message=issue.message,
        path=issue.path or None,
        details=dict(issue.details),
    )


def title_for(explicit: str | None, scenario: Scenario) -> str:
    """Название проекта или варианта.

    Пустое и состоящее из пробелов название приравнивается к пропуску: в списке проектов
    не должно появляться безымянной строки, а имя у сценария уже есть.
    """
    chosen = (explicit or "").strip()
    return chosen or scenario.meta.title.strip() or scenario.meta.id


def canonical_dict(scenario: core.Scenario) -> dict[str, Any]:
    """Сценарий в канонической форме `cosmo-A-1.0` — она же effective scenario экспорта."""
    return core.to_dict(scenario)


def config_hash(scenario: core.Scenario) -> str:
    """sha256 канонического сценария.

    Политика маршрутизации в хэш варианта не входит: она к сценарию не относится и
    выбирается при запуске. Ключ переиспользования готового Run считается иначе —
    `orbita_core.scenario.config_hash(scenario, policy)` (ADR-011).
    """
    return hashlib.sha256(core.canonical_json(scenario).encode("utf-8")).hexdigest()


def parse_stored(stored: dict[str, Any]) -> core.Scenario:
    """Канонический сценарий варианта из JSONB.

    Разбор повторяется при каждом запуске, а не кэшируется: он занимает миллисекунды и
    заодно доказывает, что сохранённый вариант по-прежнему проходит проверки ядра.
    """
    return core.parse(stored)


def run_config_hash(scenario: core.Scenario, routing_policy: str) -> str:
    """Ключ переиспользования готового Run: сценарий и политика вместе (ADR-011).

    Это хэширование, а не расчёт, поэтому оно допустимо в процессе api: маршруты при
    одинаковом сценарии зависят от политики, и запуски с разными политиками обязаны
    считаться отдельно.
    """
    return core.config_hash(scenario, routing_policy)


def describe(scenario: core.Scenario) -> ScenarioValidationResult:
    """Сводка принятого файла для экрана загрузки (`01_SPEC.md` §4.1).

    Подсчёт выведенных аппаратов — не расчёт, а прочтение поля `launch_batch` по
    определению `launch_stage` из `03_GLOSSARY.md` §1: ни геометрия, ни отказы в нём не
    участвуют, и обращаться ради него к ядру нечем — отдельной функции там нет.
    """
    active_satellites = sum(
        1 for satellite in scenario.satellites if satellite.launch_batch <= scenario.launch_stage
    )
    return ScenarioValidationResult(
        schema_version=scenario.schema_version,
        plane_count=len(scenario.planes),
        satellite_count=len(scenario.satellites),
        active_satellite_count=active_satellites,
        client_count=len(scenario.client_ids),
        gateway_count=len(scenario.gateway_ids),
        total_ticks=scenario.ticks,
        config_hash=config_hash(scenario),
    )
