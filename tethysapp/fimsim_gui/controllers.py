from tethys_sdk.routing import controller

from tethysapp.fimsim_gui.app import App


@controller
def home(request):
    """App home page (SPA catch-all): serves the built React bundle."""
    return App.render(request, 'index.html')
