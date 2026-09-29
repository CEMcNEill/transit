import os

import pytest


@pytest.mark.network
def test_network_tests_only_run_when_opted_in() -> None:
    assert os.environ.get("RUN_NETWORK_TESTS") == "1"
