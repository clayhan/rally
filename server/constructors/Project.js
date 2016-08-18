const Job = require('./Job.js');
const Worker = require('./Worker.js');
const timers = require('node-timers');
const _ = require('lodash');

// Project object takes options as input, which contains the information 
// necessary to instantiate a new Project.
// Options must be in the following format:
// options = {
//    dataSet: ARRAY, // Data to be operated on. 
//    generateDataSet: FUNCTION, (Optional input. Will use dataSet if both
//    dataSet and generateDataSet are provided)
//    mapData: FUNCTION,  // Function to run on every data item. 
//    reduceResults: FUNCTION  // Function to run on completed results array
// }
class Project {

  constructor(options, projectId, io) {
    // Project ID is created by the ProjectController and passed to Project
    this.projectId = projectId;
    this.projectType = options.projectType || null; // Used for custom visualizations
    this.title = options.title;

    // Whether or not project is complete; all jobs have been run
    this.complete = false;

    // Timer used to track how long it takes to complete project
    this.timer = timers.simple();
    this.projectTime = 0;

    // availableJobs takes in a dataSet array and converts all items to Jobs
    // dataSet may be inputted as a property of options or generated by 
    // a user-provided function
    this.availableJobs = (() => {
      let dataSet;

      // this is to tell if the code is coming from the server or client (if client, type will be string)
      if (typeof options.generateDataSet === 'function') {
        
        dataSet = JSON.parse(options.dataSet) || options.generateDataSet();
      
      }else{
        
        if (options.dataSet === "") {
          options.dataSet = null;
        }
        
        dataSet = JSON.parse(options.dataSet) || eval('(' + options.generateDataSet + ')()');
      }
      
      return dataSet.map( (item, index) => {
        return new Job(item, index, this.projectId);
      });
    })();

    // jobsLength stores the number of jobs that were available when the 
    // was first initialized. This is used to determine when the project
    // as completed.
    this.jobsLength = this.availableJobs.length;  
    
    // Creates completedJobs array which stores the RESULTS of completed jobs
    // Each job's result is placed at that job's original availableJobs index
    this.completedJobs = [];
    // this.completedJobs = _.times(this.jobsLength, _.constant([])); 
  
    // Creates workers object to track all workers for this project
    // Workers object takes workerId as key and stores the Worker object
    // as property. NOTE: a Worker's workerID is equal to the socket ID of 
    // the user that asked for the Worker to be created.
    this.workers = {};

    // reduceResults will be run at the completion of the project.
    // finalResult, which stores the result of the reduceResult, will be 
    // sent to all clients that are currently working on the project.
    this.reduceResults = options.reduceResults;

    this.finalResult = null;

    // mapData function is run by the client on the data field of each Job
    // that the client receives. The result is saved to job.result and the
    // entire job object is sent back to the server
    // TODO: implement ability tos end this function to client as a string
    this.mapData = options.mapData;

    this.io = io;
  }

  assignJob(worker) {
    // Assigns a new job to the passed-in Worker
    // Will assign the first job from availableJobs array

    if (worker.currentJob.length < worker.maxJobs && this.availableJobs.length) {
      console.log('Assigning job to ', worker.workerId);

      let newJob = this.availableJobs.shift();
      newJob.mapData = this.mapData.toString();
      newJob.workerId = worker.workerId;
      newJob.jobsLength = this.jobsLength;
      worker.currentJob.push(newJob);

      // Send the newly assigned job to this worker
      worker.socket.emit('newJob', newJob);

      // Alternate timer
      if (this.timer.state() === 'clean' || this.timer.state() === 'stopped') {
        this.timer.start();
      }

    } else {
      if (!this.availableJobs.length) {
        console.log('No more jobs available');

      } else {
        console.log('Error assigning job to worker');

      }
    }
  }

  reassignJob(socketId) {
    // console.log('Reassigning jobs of ', socketId);
    // Reassigns jobs that were previously assigned to a disconnected user
    // Locates the worker based on its socketId and find the assigned jobs.
    // Then the method puts jobs into the front of the availableJobs array
    if (this.workers[socketId] && this.workers[socketId].currentJob.length) {
      console.log('This worker has following number of jobs:', this.workers[socketId].currentJob.length);
      // for (var i = 0; i < this.workers[socketId].currentJob.length; i++) {
      //   this.workers[socketId].currentJob[i].workerId = null;
      //   this.availableJobs.unshift( this.workers[socketId].currentJob.pop() );
        
      // }
      while (this.workers[socketId].currentJob.length) {
        let oldJob = this.workers[socketId].currentJob.pop();
        oldJob.workerId = null;
        this.availableJobs.unshift( oldJob );
        console.log('Reassigning job');
      }

      this.workers[socketId].currentJob = [];
    } else {
      console.log('Error reassigning job: no worker found with that ID');
    }
  }

/*
==================================
USER-INTERFACE-AFFECTING FUNCTIONS
==================================
*/
  createWorker(readyMessage, socket) {
    const projectId = readyMessage.projectId;

    console.log('Creating a new worker in ' + projectId + ' for: ', socket.id);
    // Creates a new Worker and uses it in this project
    if (this.projectId === projectId && typeof socket === 'object') {
      var newWorker = new Worker(projectId, socket);
      newWorker.maxJobs = readyMessage.maxWorkerJobs;
      console.log('Created new worker capable of max jobs:', newWorker.maxJobs);

      // Assigns the worker a job by invoking the project's assingJob
      // method. Assign as many jobs as the worker can take.
      for (var i = 0; i < newWorker.maxJobs; i++) {
        if (this.availableJobs.length) {
          this.assignJob(newWorker);
        }
      }

      // Places the worker into the workers object, using the worker's
      // socket ID as the key
      this.workers[newWorker.workerId] = newWorker;

      // Iterate over all workers in the workers object, and emit to them the workers array
      // NOTE: do NOT use 'this' inside the emit function. Doing so will
      // cause a maximum stack call exceeded error, for some reason.
      // Unfortunately, this requires us to generate a workersList array
      // to pass into the socket message. Hacky. Need to refactor.
      // TODO: refactor to use socket rooms to broadcast messages?

      var workersList = [];
      for (var key in this.workers) {
        workersList.push(this.workers[key].workerId);
      }
      for (var key in this.workers) {
        this.workers[key].socket.emit('updateWorkers', workersList);
      }

      // Send the user of this worker the latest results
      var completed = this.completedJobs.map( (job) => {
        return job;
      });
      newWorker.socket.emit('updateResults', completed);

    } else {
      console.log('Error creating worker: invalid input type');
    }
  }

  removeWorker(socketId) {
    console.log(`Removing worker ${socketId} in project ${this.projectId}`);
    // Removes the worker associated with the passed in socketId
    // First reassign the disconnected worker's job
    this.reassignJob(socketId);

    // Then delete the worker from the worker object
    delete this.workers[socketId];
    if (_.isEmpty(this.workers)) {
      this.timer.stop();
    }

    // Iterate over all workers in the workers object, and emit to them the workers array
    // NOTE: do NOT use 'this' inside the emit function. Doing so will
    // cause a maximum stack call exceeded error, for some reason.
    // Unfortunately, this requires us to generate a workersList array
    // to pass into the socket message. Hacky. Need to refactor.
    // TODO: refactor to use socket rooms to broadcast messages?
    var workersList = [];
    for (var key in this.workers) {
      workersList.push(this.workers[key].workerId);
    }
    for (var key in this.workers) {
      this.workers[key].socket.emit('updateWorkers', workersList);
    }
  }

  handleResult(job) {
    console.log('Result received for job id: ', job.jobId);

    // Check whether this is a valid job for this project
    if (this.workers[job.workerId]) {

      // Places job's result into completedJobs array based on the job's original index location in availableJobs
      this.completedJobs[job.jobId] = job.result;

      // Remove completed job from worker's currentJob list
      let idx = null;
      this.workers[job.workerId].currentJob.forEach( (currentJob, i) => {
        if (job.jobId === currentJob.jobId) {
          idx = i;
        }
      });

      if (idx !== null) {
        this.workers[job.workerId].currentJob = this.workers[job.workerId].currentJob.slice(0, idx).concat(this.workers[job.workerId].currentJob.slice(idx + 1));
        console.log('This worker has jobs left:', this.workers[job.workerId].currentJob.length);
      } else {
        console.log('Error: job not found');
      }

      // Completes the project if all jobs have been completed
      if (this.jobsLength === this.completedJobs.length) {
        this.timer.stop();
        this.projectTime = this.timer.time();
        return this.completeProject();
      } else {
        this.assignJob(this.workers[ job.workerId ]);
      }

    } else {
      console.log('Error: worker not found for this job');
    }
    return false;
  }

  completeProject() {
    console.log('Project ' + this.projectId + ' has completed');
    // Completes the project
    // Calls reduceResults on the array of results and stores the result
    // in finalResult

    // this is to check if the code is coming from server or client
    if (this.reduceResults === 'function'){
      this.finalResult = this.reduceResults(this.completedJobs);
    } else {
      var func = eval(this.reduceResults);
      this.finalResult = func(this.completedJobs);
    }

    // Log the time when the project finished
    console.log(`Project completed after ${this.projectTime} miliseconds`);
    this.complete = true;
    console.log(this.completedJobs.length + ' jobs completed!');
    return true;
  }
}

// export Project class
module.exports = Project;
