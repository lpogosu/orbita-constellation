"""Проверка входного файла сценария (`05_API.md` §2)."""

from fastapi import APIRouter

from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.scenario import Scenario, ScenarioValidationResult
from orbita_api.services import scenarios

router = APIRouter(tags=["scenarios"])


@router.post(
    "/scenarios/validate",
    summary="Проверить сценарий без сохранения",
    responses=error_responses(400),
)
async def validate_scenario(scenario: Scenario) -> ScenarioValidationResult:
    """Проверяет файл и возвращает состав группировки.

    Проект и вариант не создаются: экран загрузки показывает пользователю, что именно
    будет считаться, до того как он заведёт проект.
    """
    return scenarios.describe(scenarios.parse(scenario))
