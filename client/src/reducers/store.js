import {combineReducers} from 'redux';
import ProjectsList from './reducer_projects';
import SelectedProject from './reducer_selected_project';
import CreatedSocket from './reducer_socket_methods';
import UpdateWorkers from './reducer_workers';  
import UpdateJob from './reducer_update_job';
import UpdateResults from './reducer_results';

const rootReducer = combineReducers({
  projects: ProjectsList,
  selectedProject: SelectedProject,
  createdSocket: CreatedSocket,
  updateWorkers: UpdateWorkers,
  updateJob: UpdateJob,
  updateResults: UpdateResults
});

export default rootReducer;