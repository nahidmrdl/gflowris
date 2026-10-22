"""Check only the source allowlist used by releases and initial publication."""
from release_utils import audit, source_files
files = list(source_files())
audit(files)
print(f'Publication audit passed for {len(files)} files.')
