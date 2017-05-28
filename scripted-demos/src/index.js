import DynamicRuntime from 'dynamic-runtime';
import programs from './programs';

const runtime = new DynamicRuntime();

const programListElem = document.getElementById('program-list');

const startProgram = (program) => {
  // Clear any previous patch
  runtime.clear();

  program.run(runtime);
}

for (const prog of programs) {
  const anchorElem = document.createElement('a');
  anchorElem.textContent = prog.name;
  anchorElem.setAttribute('href', '#');
  (() => {
    anchorElem.addEventListener('click', (e) => {
      e.preventDefault();
      setTimeout(() => { // start program with delay so it doesn't get this click event
        startProgram(prog);
      }, 0);
    });
  })();

  const itemElem = document.createElement('li');
  itemElem.appendChild(anchorElem);

  programListElem.appendChild(itemElem);
}

startProgram(programs[0]);
