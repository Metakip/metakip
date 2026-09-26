import { Hono } from 'hono';
import { requireV1Auth } from '../../middleware/v1Auth';
import contentBoundaryOperationsRoute from './contentBoundaryOperations';
import exactEditsRoute from './exactEdits';
import pageContentRoute from './pageContent';
import pageImagesRoute from './pageImages';
import pageResourcesRoute from './pageResources';

const pagesV1Route = new Hono();
pagesV1Route.use('*', requireV1Auth);
pagesV1Route.route('/', pageResourcesRoute);
pagesV1Route.route('/', pageContentRoute);
pagesV1Route.route('/', pageImagesRoute);
pagesV1Route.route('/', exactEditsRoute);
pagesV1Route.route('/', contentBoundaryOperationsRoute);

export default pagesV1Route;
