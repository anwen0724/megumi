"""Development-only model catalog generation; never imported by runtime AI configuration."""


class CatalogError(ValueError):
    """A maintenance failure that must not publish a partial catalog."""
