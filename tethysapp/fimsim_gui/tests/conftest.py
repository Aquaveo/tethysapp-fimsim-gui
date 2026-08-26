"""Standalone-pytest support: django-storages backends read django settings
lazily, so configure a minimal settings module when tests run outside the
portal (tethys manage test configures its own)."""
import django
from django.conf import settings

if not settings.configured:
    settings.configure(USE_TZ=True, INSTALLED_APPS=[], DATABASES={})
    django.setup()
