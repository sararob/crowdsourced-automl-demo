// Copyright 2018 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// TODO: configure these for your own project
const project_name = 'your_cloud_project';
const project_region = 'your_project_region';
const dataset_id = 'your_automl_dataset_id';

// TODO: replace this with the model name and labels for your dataset
const bucket_prefix = 'cheese';
const labels = ['blue', 'camembert', 'brie'];

const model_name = `${bucket_prefix}_${new Date().getTime()}`;
const num_labels = labels.length;
const img_threshold = 10;

// Dependencies
const fs = require('fs');
const functions = require('firebase-functions');
const firebase = require('firebase-admin');
firebase.initializeApp();
const database = firebase.database();
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const automl = require('@google-cloud/automl');
const automlClient = new automl.AutoMlClient();

function writeToDB(path) {
    database.ref(path).transaction(function(labelCount) {
        return labelCount + 1;
      });
}

function checkFileType(type) {
    const allowedTypes = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'ico'];
    if (allowedTypes.includes(type)) {
        return true;
    } else {
        return false;
    }
}

function createCSV(bucket) {
    let csvString = '';
    return new Promise((resolve, reject) => {
        bucket.getFiles({prefix: bucket_prefix})
        .then(results => {
            for (let i in results[0]) {
                let filename = results[0][i].name;
                let filetype = filename.substring(filename.lastIndexOf('.') + 1, filename.length);
                let allowedFileType = checkFileType(filetype);

                if (allowedFileType && (filename.includes("/images/" == false))) {
                    let strippedName = filename.substring(filename.indexOf(bucket_prefix) + bucket_prefix.length + 1, filename.length);
                    let label = strippedName.substring(0, strippedName.indexOf('/'));
                    let fileURL = `gs://${project_name}-vcm/${filename}`;
                    csvString += `${fileURL},${label}\n`;
                }
            }
            resolve(csvString);
        });
    });
}

function uploadToGcs(filepath) {
    console.log('starting upload to gcs...');
    return new Promise((resolve, reject) => {
        storage
            .bucket(`${project_name}-vcm`)
            .upload(filepath, {destination: `${bucket_prefix}.csv`})
            .then(() => {
                resolve('upload successful');
            })
            .catch(err => {
                reject(err);
            });
    })

}

function uploadToAutoML(csvPath) {
    return new Promise((resolve, reject) => {
        console.log('csvpath', csvPath);
        const request = {
            name: automlClient.datasetPath(project_name, project_region, dataset_id), 
            inputConfig: { 
                "gcsSource": {
                    "inputUris": [csvPath]
                }
            }
        };
        console.log('calling importData...');
        automlClient.importData(request)
        .then(responses => {
            let op = responses[0];
            op.on('complete', (result, metadata, finalresp) => {
                resolve('dataset uploaded successfully!');
            });
            op.on('error', err => {
                reject('error occurred uploading dataset to automl', err);
            });   
        });
    });
}

function startTraining() {
    return new Promise((resolve, reject) => {
        const request = {
            parent: automlClient.locationPath(project_name, project_region),
            model: {
                imageClassificationModelMetadata: {
                    trainBudget: 1
                },
                displayName: model_name,
                datasetId: dataset_id
            }
        }
        automlClient.createModel(request)
            .then(responses => {
                resolve(responses);
            })
            .catch(err => {
                reject(`error occurred training model: ${err}`);
            });
    });
}

// Copy new photo to the AutoML bucket for the project
exports.uploadToVcmBucket = functions.storage.object().onFinalize(event => {
    const file = storage.bucket(event.bucket).file(event.name);
    const newLocation = `gs://${project_name}-vcm/${event.name}`;
    // TODO: run through Vision safe search?
    return file.copy(newLocation)
        .then((err, copiedFile, resp) => {
            return event.name.substring(0, event.name.lastIndexOf('/'));
        }).then((label) => {
            return writeToDB(label);
        });
});

// Check to see if we've got enough images of each label
// If we do, create a csv and upload to AutoML
exports.checkNumImages = functions.database.ref(bucket_prefix).onWrite((snap, context) => {
    const afterData = snap.after.val();
    let num_labels_with_enough_photos = 0;
    for (let i in afterData) {
        if (afterData[i] >= img_threshold) {
            num_labels_with_enough_photos += 1;
        }
    }
    const automlBucketPath = storage.bucket(`${project_name}-vcm`);

    if (num_labels_with_enough_photos == num_labels) {
        return createCSV(automlBucketPath)
        .then(csvData => {
            console.log('got the csv', csvData);
            return fs.writeFile('/tmp/labels.csv', csvData);
        })
        .then(err => {
            if (err) { console.log(err); }
            return uploadToGcs('/tmp/labels.csv');
        })
        .then((uploadResp) => {
            if (uploadResp != 'upload successful') {
                console.log('error on gcs uplaod');
            } else {
                console.log('uploading csv to automl...')
                return uploadToAutoML(`gs://${project_name}-vcm/${bucket_prefix}.csv`);
            }
        })
        .then(responses => {
            return startTraining();
        })
        .then(metadata => {
            console.log(`training job metadata: ${metadata}`);
            return metadata;
        });
    } else {
        return 'not enough photos yet';
    }
});