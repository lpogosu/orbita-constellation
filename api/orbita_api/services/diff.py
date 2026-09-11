"""Diff двух канонизированных сценариев в точечной нотации (`05_API.md` §1).

Diff считается по сценариям, уже прошедшим канонизацию ядром: углы нормализованы,
интервалы недоступности объединены, списки отсортированы. Иначе «изменением» оказалось бы
то, что на расчёт не влияет, и Experiment Lineage показывал бы шум вместо инженерного
решения.
"""

from collections.abc import Mapping, Sequence
from typing import Final, TypeGuard

from orbita_api.schemas.common import ParameterChange

# Поле, по которому элементы списка считаются одним и тем же объектом. Сравнение по
# позиции сделало бы изменением любую перестановку и любую вставку в середину: в списке,
# отсортированном по `id`, новый элемент сдвигает все следующие.
IDENTITY_FIELD: Final[dict[str, str]] = {
    "design.planes": "id",
    "design.satellites": "id",
    "ground_sites": "id",
    "failures": "satellite_id",
    "gateway_outages": "gateway_id",
}

# Ключ элемента списка: значение поля идентичности и порядковый номер среди элементов с
# тем же значением. Номер нужен только интервалам недоступности: у одного аппарата их
# бывает несколько, а собственного идентификатора у интервала нет.
_ElementKey = tuple[str, int]


def scenario_diff(
    parent: Mapping[str, object],
    child: Mapping[str, object],
) -> list[ParameterChange]:
    """Изменения, которые превращают родительский сценарий в дочерний."""
    changes: list[ParameterChange] = []
    _compare(parent, child, "", changes)
    return changes


def _compare(parent: object, child: object, path: str, changes: list[ParameterChange]) -> None:
    if isinstance(parent, Mapping) and isinstance(child, Mapping):
        _compare_mappings(parent, child, path, changes)
    elif _is_list(parent) and _is_list(child):
        _compare_lists(parent, child, path, changes)
    elif parent != child:
        changes.append(_change(path, before=parent, after=child))


def _compare_mappings(
    parent: Mapping[str, object],
    child: Mapping[str, object],
    path: str,
    changes: list[ParameterChange],
) -> None:
    for key in sorted(set(parent) | set(child)):
        nested = f"{path}.{key}" if path else key
        if key not in parent:
            _describe(child[key], nested, changes, appeared=True)
        elif key not in child:
            _describe(parent[key], nested, changes, appeared=False)
        else:
            _compare(parent[key], child[key], nested, changes)


def _compare_lists(
    parent: Sequence[object],
    child: Sequence[object],
    path: str,
    changes: list[ParameterChange],
) -> None:
    identity = IDENTITY_FIELD.get(path)
    if identity is None:
        _compare_by_position(parent, child, path, changes)
        return

    parent_elements = _index_by_identity(parent, identity)
    child_elements = _index_by_identity(child, identity)
    # Индекс в пути берётся из того списка, где элемент есть: у изменённого и
    # добавленного - из дочернего, у удалённого - из родительского.
    for key, (index, element) in child_elements.items():
        if key in parent_elements:
            _compare(parent_elements[key][1], element, f"{path}[{index}]", changes)
        else:
            _describe(element, f"{path}[{index}]", changes, appeared=True)
    for key, (index, element) in parent_elements.items():
        if key not in child_elements:
            _describe(element, f"{path}[{index}]", changes, appeared=False)


def _compare_by_position(
    parent: Sequence[object],
    child: Sequence[object],
    path: str,
    changes: list[ParameterChange],
) -> None:
    """Списки без поля идентичности сравниваются поэлементно.

    В разделах сценария таких списков нет; правило нужно разделу `meta`, содержимое
    которого кейс не ограничивает.
    """
    for index in range(max(len(parent), len(child))):
        nested = f"{path}[{index}]"
        if index >= len(parent):
            _describe(child[index], nested, changes, appeared=True)
        elif index >= len(child):
            _describe(parent[index], nested, changes, appeared=False)
        else:
            _compare(parent[index], child[index], nested, changes)


def _index_by_identity(
    elements: Sequence[object],
    identity: str,
) -> dict[_ElementKey, tuple[int, object]]:
    indexed: dict[_ElementKey, tuple[int, object]] = {}
    seen: dict[str, int] = {}
    for index, element in enumerate(elements):
        value = str(element[identity]) if isinstance(element, Mapping) else str(element)
        ordinal = seen.get(value, 0)
        seen[value] = ordinal + 1
        indexed[(value, ordinal)] = (index, element)
    return indexed


def _describe(
    value: object,
    path: str,
    changes: list[ParameterChange],
    *,
    appeared: bool,
) -> None:
    """Добавленный или удалённый узел разворачивается до отдельных полей.

    `ParameterChange` хранит скалярное значение, а не кусок сценария: инженер читает diff
    как список «поле: было — стало», и целый объект в такой колонке нечитаем.
    """
    if isinstance(value, Mapping):
        for key in sorted(value):
            _describe(value[key], f"{path}.{key}", changes, appeared=appeared)
    elif _is_list(value):
        for index, element in enumerate(value):
            _describe(element, f"{path}[{index}]", changes, appeared=appeared)
    elif appeared:
        changes.append(_change(path, before=None, after=value))
    else:
        changes.append(_change(path, before=value, after=None))


def _change(path: str, *, before: object, after: object) -> ParameterChange:
    """Одна запись diff.

    Значения проходят через проверку модели: в канонизированном сценарии листья - только
    скаляры, и попытка положить в diff кусок структуры обязана падать здесь, а не
    показываться пользователю нечитаемой строкой.
    """
    return ParameterChange.model_validate({"path": path, "from": before, "to": after})


def _is_list(value: object) -> TypeGuard[Sequence[object]]:
    return isinstance(value, Sequence) and not isinstance(value, str | bytes)
