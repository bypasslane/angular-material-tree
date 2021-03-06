// TODO Add key controls
//      * Enter: Should select happen if branch is deepest descendent?
//      * Shift+Enter: multiple select

// TODO add third state to checkbox to show children selected

angular
  .module('angular-material-tree')
  .directive('mdBranch', branchDirective);


// checkbox html
var CHECKBOX_SELECTION_INDICATOR = angular.element('<div class="checkbox-container"><div class="checkbox-icon"></div></div>');
// branch arrow icon svg
var BRANCH_ARROW_TEMPLATE = angular.element('<div class="md-branch-icon-container">'+
  '<div class="md-branch-icon">'+
    '<svg fill="#000000" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">'+
      '<path d="M8.59 16.34l4.58-4.59-4.58-4.59L10 5.75l6 6-6 6z"/>'+
      '<path d="M0-.25h24v24H0z" fill="none"/>'+
    '</svg>'+
  '</div>'+
'</div>');

/*@ngInject*/
function branchDirective($parse, $document, $mdUtil, $filter, $$mdTree, $mdConstant) {
  return {
    restrict: 'E',
    require: ['?^mdBranchTemplates'],
    priority: 1000,
    terminal: true,
    transclude: 'element',
    compile: compile
  };


  function compile(tElement, tAttrs) {
    var expression = tAttrs.branchRepeat;
    var match = expression.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)\s*$/);
    var repeatName = match[1];
    var repeatListExpression = $parse(match[2]);
    var parentNode = tElement[0].parentNode;
    var isRoot = parentNode.nodeName === 'MD-TREE';
    var hasParentBranch = parentNode.nodeName === 'MD-BRANCH';
    var isOpen = isRoot || (hasParentBranch && parentNode.classList.contains('md-open'));

    return function postLink(scope, element, attrs, ctrls, transclude) {
      var dataWatcher;
      var items;
      var keyCodes = $mdConstant.KEY_CODE;
      var blocks = [];
      var pooledBlocks = [];
      var itemsLength = 0;
      var isUpdating = false;
      var isFilterOpen = false;
      if (isOpen) { startWatching(); }

      // standard angular filter wrapped so we can determine if the parent should be opened or closed
      scope.$mdBranchFilter = function (value) {
        var filtered = $filter('filter')(value);

        // open branches if filter string is greater than 2 and items have been found
        if (filtered && filtered.length > 2) {
          isFilterOpen = true;
          blocks.forEach(function (block) {
            $$mdTree.filterOpen(block);
          });

        // close branches if filter is less than 3 characters or no items have been found
        } else if ((!filtered || filtered.length < 3) && isFilterOpen) {
          isFilterOpen = false;
          blocks.forEach(function (block) {
            $$mdTree.filterClose(block);
          });
        }
        return filtered;
      };


      // watch model data
      function startWatching() {
        if (dataWatcher) { return; }
        dataWatcher = scope.$watchCollection(repeatListExpression, updateBranch);
      }
      // kill watcher
      function killWatching() {
        if (typeof dataWatcher === 'function') {
          dataWatcher();
          dataWatcher = undefined;
        }
      }

      // expose methods to scope
      scope.startWatching = startWatching;
      scope.killWatching = killWatching;


      function updateBranch(newItems, oldItems) {
        if (isUpdating) { return; }
        isUpdating = true;

        var i;
        var _block;
        var keys;
        var index;
        var length;
        var maxIndex;
        var newBlocks = [];
        var _itemsLength = newItems && newItems.length || 0;

        if (_itemsLength !== itemsLength) {
          itemsLength = _itemsLength;
        }
        items = newItems;


        // Detach and pool any blocks that are no longer in the viewport.
        keys = Object.keys(blocks);
        i = 0;
        length = keys.length;
        while (i < length) {
          index = parseInt(keys[i]);
          if (index >= itemsLength) {
            poolBlock(index);
          }
          i += 1;
        }

        // Update blocks that are already rendered.
        i = 0;
        while ((blocks[i] !== null && blocks[i] !== undefined)) {
          updateBlock(blocks[i], i);
          i += 1;
        }
        maxIndex = i - 1;

        // Collect blocks at the end.
        while (i < itemsLength) {
          _block = getBlock(i);
          updateBlock(_block, i);
          newBlocks.push(_block);
          i += 1;
        }

        // Attach collected blocks to the document.
        if (newBlocks.length) {
          element[0].parentNode.insertBefore(
            domFragmentFromBlocks(newBlocks),
            blocks[maxIndex] && blocks[maxIndex].element[0].nextSibling);
        }

        isUpdating = false;
      }


      // store block in memory and remove it from the dom.
      function poolBlock(index) {
        blocks[index].element
          .off('blur', onBlur)
          .off('focus', onFocus);
        pooledBlocks.unshift(blocks[index]);
        blocks[index].element[0].parentNode.removeChild(blocks[index].element[0]);
        delete blocks[index];
      }

      // update block scope and state
      function updateBlock(block, index) {
        blocks[index] = block;

        if (block.new) { updateNewBlock(block); } // configure template for new blocks
        if (!block.new && (block.scope.$index === index && block.scope[repeatName] === items[index])) {
          updateState(block.scope,  index); // update state if a block is nore or changes
          return;
        }
        block.new = false;

        // Update and digest the block's scope.
        updateScope(block.scope, index);
        updateState(block.scope,  index);

        if (!scope.$root.$$phase) {
          block.scope.$digest();
        }
      }


      // NOTE Might cause problems when applying a new scope
      // place contents into containers to display items correctly
      // this is only done once
      function updateNewBlock(block) {
        var isSelectable = block.element.attr('select') !== undefined;
        var innerContainer = angular.element('<div class="md-branch-inner">'); // branch contents
        var branchContainer = angular.element('<div class="md-branch-container">'); // nested branched
        innerContainer.append(BRANCH_ARROW_TEMPLATE.clone());
        if (isSelectable) {
          block.element.addClass('md-checkbox-enabled');
          innerContainer.append(CHECKBOX_SELECTION_INDICATOR.clone());
        }
        Array.prototype.slice.call(block.element[0].childNodes).forEach(function (node) {
          if (node.nodeType === 8 && node.nodeValue.trim() === 'mdBranch:') {
            branchContainer.append(node);
          } else {
            innerContainer.append(node);
          }
        });
        block.element.append(innerContainer);

        // add branches
        if (branchContainer[0].childNodes.length) {
          block.element.append(branchContainer);

        // if no more branches then mark as tip
        } else {
          block.element.addClass('md-tip');
        }
      }

      // Change the model value attached to the scope
      function updateScope($scope, index) {
        $scope.$index = index; // data index
        $scope.repeatName = repeatName; // data property
        $scope[repeatName] = items && items[index]; // data
        $scope.$odd = !($scope.$even = (index & 1) === 0);
        $scope.$depth = ($scope.$parent.$depth + 1) || 0;
        items[index].$$depth = $scope.$depth;
      }


      // update open state
      // disconnect/reconnect scopes
      // start watching for open items
      function updateState($scope, index) {
        var item = items ? items[index] : undefined;
        var element = $scope.$element && $scope.$element[0] ? $scope.$element : undefined;

        // reconnect all scopes
        $mdUtil.reconnectScope($scope);
        element.toggleClass('md-open', item.$$isOpen);

        // wait till next digest to change state so we do not get into an infinite loop
        $mdUtil.nextTick(function () {
          // if open then watch the data
          if (item.$$isOpen) {
            $scope.startWatching();

          // disconnect scopes that are closed
          } else {
            $mdUtil.disconnectScope($scope);
          }
        });
      }

      // set initial state on data
      function initState(item) {
        if (item.$$isOpen === undefined) {
          Object.defineProperty(item, '$$isOpen', {
            value: false,
            configurable: false,
            enumerable: false,
            writable: true
          });
        }
      }

      // check pool for block
      // otherwise create a new block
      function getBlock(index) {
        if (pooledBlocks.length) {
          return pooledBlocks.pop();
        }

        // create new block
        var block;
        transclude(function(clone, scope) {
          block = {
            element: clone,
            new: true,
            scope: scope
          };

          updateScope(scope, index);
          initState(items[index]);
          scope.$element = clone; // attach element to scope so it can be accessed in controller
          parentNode.appendChild(clone[0]);
          scope.$on('$destroy', function () {
            clone
              .off('blur', onBlur)
              .off('focus', onFocus);
          });
        });
        return block;
      }

      // add blocks to one fragment for better performance
      function domFragmentFromBlocks(blocks) {
        var fragment = $document[0].createDocumentFragment();
        blocks.forEach(function(block) {
          fragment.appendChild(block.element[0]);
          block.element.attr('tabindex', '0');
          block.element
            .on('blur', onBlur)
            .on('focus', onFocus);
        });
        return fragment;
      }


      function onBlur(e) {
        angular.element(e.target)
          .removeClass('md-focused')
          .off('keydown', onKeydown);
      }

      function onFocus(e) {
        angular.element(e.target)
          .addClass('md-focused')
          .on('keydown', onKeydown);
      }

      function onKeydown(e) {
        switch (e.keyCode) {
          case keyCodes.UP_ARROW:
            return focusPrevious(e.target);
          case keyCodes.DOWN_ARROW:
            return focusNext(e.target);
          case keyCodes.RIGHT_ARROW:
            return openNextBranch(e.target);
          case keyCodes.LEFT_ARROW:
            return closePrevBranch(e.target);
          case $$mdTree.isShiftPressed() && keyCodes.SPACE:
          case $$mdTree.isShiftPressed() && keyCodes.ENTER:
            return selectBranch(e.target, false);
          case keyCodes.SPACE:
          case keyCodes.ENTER:
            return handleEnter(e.target);
        }
      }

      // recursively find next branch
      function focusNext(branchElement) {
        branchElement = angular.element(branchElement);
        var next;
        var branchContainer = branchElement[0].querySelector('.md-branch-container');
        if (branchElement.hasClass('md-open') && branchContainer) {
          // find nearest child branch
          Array.prototype.slice.call(branchContainer.children).every(function (el) {
            if (el.nodeName === 'MD-BRANCH') { next = angular.element(el); }
            return !next;
          });

          // if no child branches are found try to get next branch
          if (!next) { next = branchElement.next(); }
        } else {
          next = branchElement.next();
        }

        // recursively find next branch
        if (!next || !next.length) { next = findNext(branchElement); }
        if (next && next.length) { next.focus(); }
      }

      // recursively find previous branch
      function focusPrevious(branchElement) {
        branchElement = angular.element(branchElement);
        var previous = branchElement[0].previousElementSibling;

        // if no previous branch exists then step out to next highest layer
        if (!previous) {
          previous = $$mdTree.getBranch(branchElement[0].parentNode);

        // if found then find the deepest and lowest sub branch
        } else {
          previous = findDeepest(previous);
        }

        // focus on element
        if (previous) { angular.element(previous).focus(); }
      }

      // keep stepping out and look for next branch that we can focus on
      function findNext(el) {
        var branch = $$mdTree.getBranch(el[0].parentNode);
        if (!branch) { return null; }
        var next = angular.element(branch).next();
        if (next && next.length) { return next; }
        return findNext(angular.element(branch));
      }

      function findDeepest(el) {
        var next;
        if (!el || el.nodeName !== 'MD-BRANCH') { return null; }
        if ($$mdTree.isOpen(el)) {
          var branchContainer = el.querySelector('.md-branch-container');
          if (branchContainer) {
            Array.prototype.slice.call(branchContainer.children).reverse().every(function (el) {
              if (el.nodeName === 'MD-BRANCH') { next = el; }
              return !next;
            });
            if (next) { return findDeepest(next); }
          }
        }
        return el;
      }

      // open branch or select next
      function openNextBranch(branchElement) {
        if (!$$mdTree.isOpen(branchElement)) {
          var arrow = $$mdTree.getArrow(branchElement);
          if (arrow && !$$mdTree.isTip(branchElement)) {
            // open branch by simulating click
            $$mdTree.getTreeElement().triggerHandler({
              type: 'click',
              target: arrow
            });
          } else {
            focusNext(branchElement);
          }
        } else {
          focusNext(branchElement);
        }
      }

      // close branch or select previous
      function closePrevBranch(branchElement) {
        if ($$mdTree.isOpen(branchElement)) {
          var arrow = $$mdTree.getArrow(branchElement);
          if (arrow) {
            // close branch by simulating click
            $$mdTree.getTreeElement().triggerHandler({
              type: 'click',
              target: arrow
            });
          } else {
            focusPrevious(branchElement);
          }
        } else {
          focusPrevious(branchElement);
        }
      }

      // open/close branch
      function handleEnter(branchElement) {
        // single select branch
        if ($$mdTree.hasCheckbox(branchElement)) {
          selectBranch(branchElement, true);
          // TODO invoke single select callback

        // toggle open/close branch
        } else {
          toggleOpen(branchElement);
        }
      }

      function toggleOpen(branchElement) {
        if ($$mdTree.canOpen(branchElement) && !$$mdTree.isTip(branchElement)) {
          // open branch by simulating click
          $$mdTree.getTreeElement().triggerHandler({
            type: 'click',
            target: $$mdTree.getArrow(branchElement)
          });
        }
      }

      function selectBranch(branchElement, single) {
        var el;
        if (single === true) {
          el = branchElement.querySelector('.md-branch-inner');
        } else {
          el = $$mdTree.getCheckbox(branchElement);
        }
        if (el) {
          $$mdTree.getTreeElement().triggerHandler({
            type: 'click',
            target: el
          });
        }
      }

    };
  }

}
