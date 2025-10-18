# Create a venv, install deps and run pytest, saving output to output/tests_output.txt
$venv = "venv_test"
if (-Not (Test-Path $venv)) { python -m venv $venv }
$activate = Join-Path $venv "Scripts\Activate.ps1"
. $activate
pip install --upgrade pip
pip install -r requirements.txt
pytest -q | Tee-Object -FilePath .\output\tests_output.txt
Write-Host "Test output saved to .\output\tests_output.txt"