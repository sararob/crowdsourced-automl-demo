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

// TODO: update these to your own model name and labels
const model_name = 'cheese';
const labels = ['blue', 'camembert', 'brie'];

$(document).ready(() => {

    const storage = firebase.storage();
    const db = firebase.database();
    const storageRef = storage.ref();

    var select = $('<select id="label-list"/>');

    for(let i in labels) {
        let label = labels[i];
        $('<option />', {value: label, text: label}).appendTo(select);
    }

    select.appendTo($('#label-dropdown'));

    // Create a HTML table for each label
    for (let i in labels) {
        let table_row = $(`<tr id='${labels[i]}'><td>${labels[i]}</td><td class='num-photos'></td></tr>`);
        table_row.appendTo($('#table-body'));
    }

    $('#file-select').on('click', () => {
        $('#img-upload').trigger("click");
    });

    $('#img-upload').on('change', e => {
        let selected_label = $('#label-list').find(":selected").text();
        let localFile = e.target.files[0];
        // Upload the image to Firebase Storage

        console.log($('#label-list').find(":selected").text());

        $('#status').text('Uploading image...');
        let imgRef = storageRef.child(model_name).child(selected_label).child(localFile.name);
        console.log(imgRef);
        imgRef.put(localFile).then(() => {
            console.log('image uploaded');
        });
    });

    // Listen for changes to the number of photos
    db.ref(model_name).on('value', (snap) => {
        let data = snap.val();
        for (let i in data) {
            let label = i;
            let num_photos = data[i];
            console.log(`label: ${label}, numphotos: ${num_photos}`);
            $(`#${label} td.num-photos`).text(num_photos);
        }
    });
});