"""
Unit tests for the pure, no-network functions in app.py — mostly server
detection (loader, MC version, Bedrock, world name) and the small path/bucket
helpers. These are exactly the functions that have caused real bugs before
(NeoForge misidentified as Forge, data loss on update, etc.), so they're the
highest-value things to pin down with tests rather than relying on manual
curl/clicking to catch a regression.

Run with:  pip install pytest && pytest
"""
import json
import zipfile
from pathlib import Path

import pytest

import app as anvil


# ---------------------------------------------------------------------------
# detect_loader
# ---------------------------------------------------------------------------

def test_detect_loader_vanilla_when_no_markers(tmp_path):
    assert anvil.detect_loader(tmp_path) == "vanilla"


def test_detect_loader_fabric_marker_file(tmp_path):
    (tmp_path / "fabric-server-launch.jar").touch()
    assert anvil.detect_loader(tmp_path) == "fabric"


def test_detect_loader_neoforge_before_forge(tmp_path):
    # Regression test for the exact bug described in the ecosystem's memory:
    # NeoForge and Forge ship the same run.sh, so NeoForge's own marker
    # (libraries/net/neoforged) must be checked before Forge's, or a NeoForge
    # server gets misidentified as plain Forge.
    (tmp_path / "libraries" / "net" / "neoforged").mkdir(parents=True)
    (tmp_path / "libraries" / "net" / "minecraftforge").mkdir(parents=True)
    assert anvil.detect_loader(tmp_path) == "neoforge"


def test_detect_loader_forge_without_neoforge_marker(tmp_path):
    (tmp_path / "libraries" / "net" / "minecraftforge").mkdir(parents=True)
    assert anvil.detect_loader(tmp_path) == "forge"


def test_detect_loader_filename_fallback(tmp_path):
    (tmp_path / "paper-1.20.1-196.jar").touch()
    assert anvil.detect_loader(tmp_path) == "paper"


# ---------------------------------------------------------------------------
# detect_mc_version
# ---------------------------------------------------------------------------

def _make_jar_with_version(path: Path, version_id: str):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("version.json", json.dumps({"id": version_id}))


def test_detect_mc_version_from_embedded_version_json(tmp_path):
    _make_jar_with_version(tmp_path / "server.jar", "1.20.1")
    version, source = anvil.detect_mc_version(tmp_path)
    assert version == "1.20.1"
    assert source == "jar"


def test_detect_mc_version_from_forge_libraries_folder(tmp_path):
    (tmp_path / "libraries" / "net" / "minecraft" / "server" / "1.20.1").mkdir(parents=True)
    version, source = anvil.detect_mc_version(tmp_path)
    assert version == "1.20.1"
    assert source == "forge"


def test_detect_mc_version_prefers_jar_over_forge_folder(tmp_path):
    # If both exist, the embedded version.json (higher confidence) wins.
    _make_jar_with_version(tmp_path / "server.jar", "1.21.0")
    (tmp_path / "libraries" / "net" / "minecraft" / "server" / "1.20.1").mkdir(parents=True)
    version, source = anvil.detect_mc_version(tmp_path)
    assert version == "1.21.0"
    assert source == "jar"


def test_detect_mc_version_from_crafty_versions_folder(tmp_path):
    (tmp_path / "versions" / "1.19.4").mkdir(parents=True)
    version, source = anvil.detect_mc_version(tmp_path)
    assert version == "1.19.4"
    assert source == "versions_folder"


def test_detect_mc_version_versions_folder_picks_highest(tmp_path):
    (tmp_path / "versions" / "1.19.4").mkdir(parents=True)
    (tmp_path / "versions" / "1.20.1").mkdir(parents=True)
    version, source = anvil.detect_mc_version(tmp_path)
    assert version == "1.20.1"
    assert source == "versions_folder"


def test_detect_mc_version_guess_from_filename_is_lowest_confidence(tmp_path):
    (tmp_path / "forge-1.20.1-47.2.20-installer.jar").touch()
    version, source = anvil.detect_mc_version(tmp_path)
    assert version == "1.20.1"
    assert source == "guess"


def test_detect_mc_version_nothing_found(tmp_path):
    version, source = anvil.detect_mc_version(tmp_path)
    assert version == ""
    assert source == ""


# ---------------------------------------------------------------------------
# is_bedrock_world
# ---------------------------------------------------------------------------

def test_is_bedrock_world_true_when_marker_present(tmp_path):
    (tmp_path / anvil.BEDROCK_MARKER_FILE).touch()
    assert anvil.is_bedrock_world(tmp_path) is True


def test_is_bedrock_world_false_for_java_server(tmp_path):
    (tmp_path / "server.jar").touch()
    assert anvil.is_bedrock_world(tmp_path) is False


# ---------------------------------------------------------------------------
# detect_world_name
# ---------------------------------------------------------------------------

def test_detect_world_name_reads_level_name(tmp_path):
    (tmp_path / "server.properties").write_text("level-name=MyWorld\nother-key=value\n")
    assert anvil.detect_world_name(tmp_path) == "MyWorld"


def test_detect_world_name_defaults_to_world(tmp_path):
    assert anvil.detect_world_name(tmp_path) == "world"


# ---------------------------------------------------------------------------
# bucket_for / dest_dir_for
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("content_type,expected_bucket", [
    ("mod", "mods"), ("plugin", "plugins"), ("datapack", "datapacks"),
])
def test_bucket_for(content_type, expected_bucket):
    assert anvil.bucket_for(content_type) == expected_bucket


def test_dest_dir_for_datapack_uses_world_name(tmp_path):
    data = {"world_name": "survival"}
    dest = anvil.dest_dir_for(str(tmp_path), data, "datapack")
    assert dest == tmp_path / "survival" / "datapacks"


def test_dest_dir_for_mod(tmp_path):
    dest = anvil.dest_dir_for(str(tmp_path), {}, "mod")
    assert dest == tmp_path / "mods"


# ---------------------------------------------------------------------------
# required_dependency_project_ids (Modrinth branch only — no network needed)
# ---------------------------------------------------------------------------

def test_required_dependency_project_ids_modrinth_filters_to_required_only():
    version = {"raw_dependencies": [
        {"project_id": "abc", "dependency_type": "required"},
        {"project_id": "def", "dependency_type": "optional"},
        {"project_id": "ghi", "dependency_type": "incompatible"},
        {"project_id": "abc", "dependency_type": "required"},  # duplicate, should dedupe
    ]}
    result = anvil.required_dependency_project_ids("modrinth", "self-project-id", version)
    assert result == ["abc"]
