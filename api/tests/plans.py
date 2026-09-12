"""Contact plan сценария репозитория: общий помощник тестов хранения.

Тесты хранилищ проверяют не расчёт, а запись и чтение, поэтому план строится ядром из
файла: подделанный вручную план не поймал бы ни одной ошибки упаковки настоящей трассы.
"""

from typing import Final

from orbita_core import contacts
from orbita_core import scenario as core_scenario
from orbita_core.contacts import ContactPlan

from conftest import read_json

# Сценарий кейса и сценарий с другими идентификаторами и другим числом аппаратов
# (ADR-015): формат хранения не должен зависеть ни от одного из них.
CASE_SCENARIO: Final[str] = "scenarios/01_full_constellation.json"
HIDDEN_SCENARIO: Final[str] = "scenarios/hidden_like.json"


def load_plan(relative: str) -> ContactPlan:
    return contacts.build(core_scenario.parse(read_json(relative)))


def plane_ids(relative: str) -> dict[str, str]:
    """Плоскость каждого аппарата — то же, что сервис берёт из сценария варианта."""
    scenario = core_scenario.parse(read_json(relative))
    return {satellite.id: satellite.plane_id for satellite in scenario.satellites}
